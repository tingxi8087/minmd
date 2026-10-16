import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const script = join(import.meta.dir, "../deploy/scripts/mirror-images.sh");
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "minmd-mirror-"));
  const bin = join(dir, "bin"),
    trace = join(dir, "trace");
  await mkdir(bin);
  await writeFile(trace, "");
  for (const name of ["skopeo", "docker"]) {
    await writeFile(
      join(bin, name),
      `#!/usr/bin/env bun
import {appendFileSync,readFileSync} from "node:fs";
const args=process.argv.slice(2);
appendFileSync(process.env.MIRROR_TRACE,JSON.stringify({tool:${JSON.stringify(name)},args})+"\\n");
if (${JSON.stringify(name)} === "skopeo") {
 if(args.includes("copy") && process.env.MIRROR_FAIL === "copy")process.exit(23);
 if(args.includes("inspect"))process.stdout.write("{}");
} else if(args.includes("inspect")) {
 const dir=args[args.indexOf("--config")+1];
 if(readFileSync(dir+"/config.json","utf8").trim()!=="{}")process.exit(24);
 console.log(JSON.stringify({manifests:(process.env.MIRROR_FAIL === "platform"?["amd64"]:["amd64","arm64"]).map(architecture=>({platform:{os:"linux",architecture}}))}));
}
`,
      { mode: 0o700 },
    );
  }
  const run = async (
    target: string,
    extra: Record<string, string> = {},
    version = "v0.1.0",
    namespace = "tingxi8087",
  ) => {
    const child = Bun.spawn(
      ["sh", script, "Example/MinMD", version, namespace, target],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          MIRROR_TRACE: trace,
          ...extra,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, out, err] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, out, err };
  };
  const calls = async () =>
    (await readFile(trace, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { tool: string; args: string[] });
  return { dir, run, calls };
}

test("四类镜像先固定来源摘要，复制两种架构，再验证匿名清单", async () => {
  for (const [target, source, tag] of [
    ["app", "ghcr.io/example/minmd-app", "v0.1.0"],
    ["migrate", "ghcr.io/example/minmd-migrate", "v0.1.0"],
    ["postgres", "docker.io/library/postgres", "18"],
    ["caddy", "docker.io/library/caddy", "2.11.4-alpine"],
  ] as const) {
    const f = await fixture();
    try {
      expect((await f.run(target)).code).toBe(0);
      const calls = await f.calls();
      expect(calls[0]!.args).toEqual([
        "inspect",
        "--raw",
        `docker://${source}:${tag}`,
      ]);
      const digest = createHash("sha256").update("{}").digest("hex");
      const copies = calls.filter(
        (c) => c.tool === "skopeo" && c.args.includes("copy"),
      );
      expect(copies).toHaveLength(4);
      for (const [index, arch] of ["amd64", "arm64"].entries()) {
        const download = copies[index * 2]!.args;
        const upload = copies[index * 2 + 1]!.args;
        expect(download).toContain(arch);
        expect(download).toContain("v2s2");
        expect(download.at(-2)).toBe(`docker://${source}@sha256:${digest}`);
        expect(download.at(-1)).toStartWith("dir:");
        expect(upload.at(-2)).toBe(download.at(-1)!);
        expect(upload.at(-1)).toBe(
          `docker://ccr.ccs.tencentyun.com/tingxi8087/minmd-${target}:${tag}-${arch}`,
        );
      }
      const destination = `ccr.ccs.tencentyun.com/tingxi8087/minmd-${target}:${tag}`;
      expect(
        calls.some(
          (c) => c.args.includes("create") && c.args.includes(destination),
        ),
      ).toBe(true);
      expect(calls.at(-1)!.args).toContain("--config");
      expect(calls.at(-1)!.args).toContain(destination);
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  }
}, 30000);

test("复制失败不发布合并清单；缺少架构不能通过匿名双架构检查", async () => {
  for (const fail of ["copy", "platform"]) {
    const f = await fixture();
    try {
      const result = await f.run("app", { MIRROR_FAIL: fail });
      expect(result.code).not.toBe(0);
      if (fail === "copy") {
        expect(result.code).toBe(23);
        expect((await f.calls()).some((c) => c.args.includes("create"))).toBe(
          false,
        );
      }
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  }
}, 30000);

test("未知目标、可变版本与非法命名空间在联网前拒绝", async () => {
  const f = await fixture();
  try {
    for (const [target, version, namespace] of [
      ["unknown", "v0.1.0", "tingxi8087"],
      ["app", "latest", "tingxi8087"],
      ["app", "v0.1.0", "../other"],
    ]) {
      expect((await f.run(target!, {}, version!, namespace!)).code).not.toBe(0);
    }
    expect(await f.calls()).toEqual([]);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("手动国内同步仅包含应用和迁移，基础镜像保留手动维护入口", async () => {
  const workflow = Bun.YAML.parse(
    await readFile(
      join(import.meta.dir, "../.github/workflows/china-images.yml"),
      "utf8",
    ),
  ) as {
    jobs: { mirror: { strategy: { matrix: { target: string[] } } } };
  };
  expect(workflow.jobs.mirror.strategy.matrix.target).toEqual([
    "app",
    "migrate",
  ]);
});
