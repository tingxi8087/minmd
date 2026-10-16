import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkManifest,
  imageBuild,
  options,
  release,
  retry,
  type Run,
} from "../scripts/release";

const manifest = JSON.stringify({
  manifests: ["amd64", "arm64"].map((architecture) => ({
    platform: { os: "linux", architecture },
  })),
});
test("固定版本与包版本一致，非法参数在执行命令前拒绝", () => {
  expect(options([], "0.1.4")).toEqual({
    version: "v0.1.4",
    verifyOnly: false,
  });
  expect(options(["--verify-only", "v0.1.4"], "0.1.4").verifyOnly).toBe(true);
  for (const args of [
    ["latest"],
    ["v0.1.3"],
    ["--unknown"],
    ["v0.1.4", "extra"],
  ])
    expect(() => options(args, "0.1.4")).toThrow();
});
test("公开清单拒绝缺架构、额外证明、重复架构和错误系统", () => {
  checkManifest(manifest);
  for (const raw of [
    "{}",
    manifest.replaceAll("arm64", "amd64"),
    manifest.replaceAll("linux", "windows"),
  ])
    expect(() => checkManifest(raw)).toThrow();
});
test("网络重试有上限，暂时故障恢复后不再执行", async () => {
  let count = 0;
  await retry(
    async () => {
      if (++count < 2) throw new Error("temporary");
    },
    async () => {},
  );
  expect(count).toBe(2);
  count = 0;
  await expect(
    retry(
      async () => {
        count++;
        throw new Error("permanent");
      },
      async () => {},
    ),
  ).rejects.toThrow("permanent");
  expect(count).toBe(3);
});
async function fixture(failure = "") {
  const workspace = await mkdtemp(join(tmpdir(), "minmd-release-unit-"));
  await writeFile(
    join(workspace, "package.json"),
    JSON.stringify({ version: "0.1.4", workspaces: [] }),
  );
  await writeFile(join(workspace, "bun.lock"), "{}");
  const calls: string[][] = [];
  const run: Run = async (args) => {
    calls.push(args);
    if (args.join(" ") === "git rev-parse HEAD") return "a".repeat(40);
    if (args[0] === "git" && args[1] === "ls-files")
      return "package.json\0bun.lock\0";
    if (args[0] === "node") return "v22.0.0";
    if (args[0] === "docker" && args.includes("--bootstrap"))
      return "linux/amd64, linux/arm64";
    if (args[0] === "gh" && args[1] === "api") {
      if (args[2]?.includes("commits/")) return "a".repeat(40);
      return failure === "published"
        ? JSON.stringify([{ tag_name: "v0.1.4", draft: false }])
        : "[]";
    }
    if (args[0] === "git" && args[1] === "status" && failure === "dirty")
      return " M README.md";
    if (args[1] === "scripts/release-verify.ts" && failure === "verification")
      throw new Error("验收失败");
    if (args.includes("manifest") && args.includes("inspect")) {
      if (failure === "anonymous") throw new Error("未公开");
      const config = args[args.indexOf("--config") + 1]!;
      expect(await readFile(join(config, "config.json"), "utf8")).toBe("{}");
      return manifest;
    }
    return "";
  };
  return {
    workspace,
    calls,
    run,
    cleanup: () => rm(workspace, { recursive: true, force: true }),
  };
}
test("本机发布只编译一次，四个架构镜像直接推双仓库，匿名检查后最后发布", async () => {
  const f = await fixture();
  try {
    await release({ version: "v0.1.4", verifyOnly: false }, f.run, f.workspace);
    const calls = f.calls;
    expect(calls.filter((a) => a.join(" ") === "bun run build")).toHaveLength(
      1,
    );
    const builds = calls.filter((a) => a.includes("--load"));
    expect(builds).toHaveLength(4);
    expect(builds.filter((a) => a.includes("app-prebuilt"))).toHaveLength(2);
    expect(
      calls.filter((a) => a[1] === "push" && a[0] === "docker"),
    ).toHaveLength(8);
    expect(calls.some((a) => a[1] === "pull")).toBe(false);
    expect(
      calls.filter((a) => a.includes("manifest") && a.includes("inspect")),
    ).toHaveLength(4);
    expect(
      calls.findIndex((a) => a[1] === "scripts/release-verify.ts"),
    ).toBeLessThan(calls.findIndex((a) => a[1] === "push"));
    const upload = calls.find((a) => a[0] === "gh" && a[2] === "upload")!;
    expect(upload.filter((a) => a.startsWith(f.workspace))).toHaveLength(8);
    expect(calls.at(-1)).toContain("--draft=false");
    expect(calls.at(-1)).toContain("--latest");
  } finally {
    await f.cleanup();
  }
});
test("仅验收不执行远端写入；失败验收、脏工作区和已发布版本不推镜像", async () => {
  for (const failure of ["", "verification", "dirty", "published"]) {
    const f = await fixture(failure);
    try {
      const task = release(
        { version: "v0.1.4", verifyOnly: !failure },
        f.run,
        f.workspace,
      );
      if (failure) await expect(task).rejects.toThrow();
      else await task;
      expect(
        f.calls.some(
          (a) => a[1] === "push" || (a[2] === "create" && a[0] === "gh"),
        ),
      ).toBe(false);
      // finally 释放锁，失败后允许重新执行。
      await expect(
        stat(join(f.workspace, ".cache/release.lock")),
      ).rejects.toThrow();
    } finally {
      await f.cleanup();
    }
  }
});
test("匿名访问检查失败不会转正式 Release 或上传附件", async () => {
  const f = await fixture("anonymous");
  try {
    await expect(
      release({ version: "v0.1.4", verifyOnly: false }, f.run, f.workspace),
    ).rejects.toThrow("未公开");
    expect(
      f.calls.some((a) => a.includes("--draft=false") || a[2] === "upload"),
    ).toBe(false);
  } finally {
    await f.cleanup();
  }
}, 15000);
test("预构建 Docker 入口保留源码 app 入口且不执行前端编译", async () => {
  const dockerfile = await Bun.file(
    join(import.meta.dir, "../deploy/Dockerfile"),
  ).text();
  const prebuilt = dockerfile
    .split("FROM app-runtime AS app-prebuilt")[1]!
    .split("FROM app-runtime AS app")[0]!;
  expect(prebuilt).toContain("COPY --from=release-artifacts /web");
  expect(prebuilt).not.toContain("bun run build");
  expect(dockerfile).toContain("FROM app-runtime AS app\n");
  expect(imageBuild("app", "arm64", "v0.1.4", "revision")).toContain(
    "release-artifacts=./dist",
  );
});
test("发布相关工作流仅手动触发，Pages 自动更新保持独立", async () => {
  for (const name of ["release", "china-images", "install-smoke"]) {
    const workflow = Bun.YAML.parse(
      await Bun.file(
        join(import.meta.dir, `../.github/workflows/${name}.yml`),
      ).text(),
    ) as { on: Record<string, unknown> };
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.on).not.toHaveProperty("push");
    expect(workflow.on).not.toHaveProperty("workflow_run");
  }
});
test("构建快照排除开发环境文件，子进程使用隔离配置且失败后清理快照", async () => {
  const f = await fixture();
  let snapshot = "";
  await writeFile(
    join(f.workspace, ".env"),
    "POSTGRES_PASSWORD=development-only\n",
  );
  await writeFile(
    join(f.workspace, "sample.ts"),
    "export const sample = true;\n",
  );
  const execute: Run = async (args, settings) => {
    if (args[0] === "git" && args[1] === "ls-files") return ".env\0sample.ts\0";
    if (args.join(" ") === "bun run check") {
      snapshot = settings!.cwd!;
      expect(settings!.env!.POSTGRES_PASSWORD).toBeUndefined();
      expect(settings!.env!.HTTP_PROXY).toBe("");
      expect(await Bun.file(join(snapshot, ".env")).exists()).toBe(false);
      expect(await Bun.file(join(snapshot, "sample.ts")).text()).toContain(
        "sample = true",
      );
      throw new Error("停止于验收");
    }
    return f.run(args, settings);
  };
  try {
    await expect(
      release({ version: "v0.1.4", verifyOnly: true }, execute, f.workspace),
    ).rejects.toThrow("停止于验收");
    expect(await Bun.file(join(f.workspace, ".env")).text()).toContain(
      "development-only",
    );
    await expect(stat(snapshot)).rejects.toThrow();
  } finally {
    await f.cleanup();
  }
});
test("已存在且指向相同提交的注解标签不会被改写", async () => {
  const f = await fixture();
  const execute: Run = async (args, settings) => {
    if (args[0] === "git" && args[1] === "ls-remote")
      return `${"b".repeat(40)}\trefs/tags/v0.1.4\n${"a".repeat(40)}\trefs/tags/v0.1.4^{}`;
    return f.run(args, settings);
  };
  try {
    await release(
      { version: "v0.1.4", verifyOnly: false },
      execute,
      f.workspace,
    );
    expect(
      f.calls.some((args) => args[0] === "git" && args[1] === "push"),
    ).toBe(false);
    expect(f.calls.at(-1)).toContain("--draft=false");
  } finally {
    await f.cleanup();
  }
});
test("同工作区并发发布被锁阻止，不会移除首个任务的锁", async () => {
  const f = await fixture();
  let unblock!: () => void;
  let ready!: () => void;
  const gate = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const execute: Run = async (args, settings) => {
    if (args.join(" ") === "bun install --frozen-lockfile") {
      ready();
      await gate;
    }
    return f.run(args, settings);
  };
  const first = release(
    { version: "v0.1.4", verifyOnly: true },
    execute,
    f.workspace,
  );
  try {
    await started;
    await expect(
      release({ version: "v0.1.4", verifyOnly: true }, f.run, f.workspace),
    ).rejects.toThrow("已有本机发布");
    expect(
      (await stat(join(f.workspace, ".cache/release.lock"))).isDirectory(),
    ).toBe(true);
  } finally {
    unblock();
    await first;
    await f.cleanup();
  }
});
test("镜像推送持续失败只尝试三次，保留草稿且不合并清单或正式发布", async () => {
  const f = await fixture();
  const execute: Run = async (args, settings) => {
    const result = await f.run(args, settings);
    if (args[0] === "docker" && args[1] === "push") throw new Error("上传失败");
    return result;
  };
  try {
    await expect(
      release({ version: "v0.1.4", verifyOnly: false }, execute, f.workspace),
    ).rejects.toThrow("上传失败");
    expect(
      f.calls.filter((args) => args[0] === "docker" && args[1] === "push"),
    ).toHaveLength(3);
    expect(
      f.calls.some(
        (args) => args.includes("imagetools") || args.includes("--draft=false"),
      ),
    ).toBe(false);
    expect(f.calls.some((args) => args.includes("--draft"))).toBe(true);
  } finally {
    await f.cleanup();
  }
}, 15000);
