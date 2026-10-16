import {
  dependencyInstall,
  prepareDependencyManifests,
} from "./release-dependencies";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const architectures = ["amd64", "arm64"] as const;
export const targets = ["app", "migrate"] as const;
const root = resolve(import.meta.dir, "..");
const versionPattern = /^v\d+\.\d+\.\d+(?:[.-][A-Za-z0-9.-]+)?$/;
export function options(args: string[], packageVersion: string) {
  const verifyOnly = args.includes("--verify-only");
  const positional = args.filter((arg) => arg !== "--verify-only");
  const version = positional[0] ?? `v${packageVersion}`;
  if (positional.length > 1 || !versionPattern.test(version))
    throw new Error(
      "用法：bun run release [v版本] [--verify-only]，不支持 latest",
    );
  if (version !== `v${packageVersion}`)
    throw new Error(
      "发布版本必须与根 package.json 一致，请先修改版本并提交源码",
    );
  return { version, verifyOnly };
}
export function imageBuild(
  target: string,
  arch: string,
  version: string,
  revision: string,
) {
  return [
    "docker",
    "buildx",
    "build",
    "--platform",
    `linux/${arch}`,
    "--file",
    "deploy/Dockerfile",
    "--target",
    target === "app" ? "app-prebuilt" : "migrate",
    "--build-context",
    "release-artifacts=./dist",
    "--build-context",
    `release-dependencies=./.cache/release-dependencies/${arch}`,
    "--build-arg",
    "DEPENDENCIES_STAGE=dependencies-prebuilt",
    "--load",
    "--provenance=false",
    "--label",
    `org.opencontainers.image.revision=${revision}`,
    "--label",
    `org.opencontainers.image.version=${version}`,
    "--label",
    "org.opencontainers.image.source=https://github.com/tingxi8087/minmd",
    "--tag",
    `minmd-release-${target}:${version}-${arch}`,
    ".",
  ];
}
export function checkManifest(raw: string) {
  const data = JSON.parse(raw) as {
    manifests?: { platform?: { os?: string; architecture?: string } }[];
  };
  const platforms = data.manifests
    ?.map((item) => `${item.platform?.os}/${item.platform?.architecture}`)
    .sort();
  if (
    JSON.stringify(platforms) !== JSON.stringify(["linux/amd64", "linux/arm64"])
  )
    throw new Error("公开镜像清单必须恰好包含 linux/amd64 和 linux/arm64");
}
export type Run = (
  args: string[],
  settings?: {
    quiet?: boolean;
    env?: Record<string, string | undefined>;
    cwd?: string;
    timeout?: number;
  },
) => Promise<string>;
const run: Run = async (args, settings = {}) => {
  console.log(`\n> ${args.join(" ")}`);
  const child = Bun.spawn(args, {
    cwd: settings.cwd ?? root,
    env: { ...process.env, ...settings.env },
    stdout: settings.quiet ? "pipe" : "inherit",
    stderr: "inherit",
    timeout: settings.timeout ?? 1200000,
  });
  const [code, output] = await Promise.all([
    child.exited,
    settings.quiet ? new Response(child.stdout).text() : Promise.resolve(""),
  ]);
  if (code !== 0)
    throw new Error(`${args[0]} ${args[1] ?? ""} 失败（${code}），发布已停止`);
  return output.trim();
};
export async function retry(
  action: () => Promise<unknown>,
  sleep = (ms: number) => Bun.sleep(ms),
) {
  for (let attempt = 1; ; attempt++) {
    try {
      await action();
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      console.log(`网络操作失败，准备重试（${attempt}/3）`);
      await sleep(attempt * 2000);
    }
  }
}

export async function release(
  input: ReturnType<typeof options>,
  execute: Run = run,
  workspace = root,
) {
  const { version, verifyOnly } = input;
  const repository = "tingxi8087/minmd";
  const prefixes = [
    "ghcr.io/tingxi8087/minmd",
    "ccr.ccs.tencentyun.com/tingxi8087/minmd",
  ];
  const revision = await execute(["git", "rev-parse", "HEAD"], { quiet: true });
  await execute(["docker", "info"], { quiet: true });
  await execute(["docker", "compose", "version"]);
  const builder = await execute(
    ["docker", "buildx", "inspect", "--bootstrap"],
    { quiet: true },
  );
  if (!architectures.every((arch) => builder.includes(`linux/${arch}`)))
    throw new Error(
      "Docker Buildx 需要同时支持 linux/amd64 和 linux/arm64；macOS 可启动 Docker Desktop，Linux 需配置 QEMU",
    );
  const nodeVersion = await execute(["node", "--version"], { quiet: true });
  if (!/^v(?:2[2-9]|[3-9]\d)\./.test(nodeVersion))
    throw new Error("需要 Node.js 22 或更新版本构建前后台");
  // 发布与本机验收互斥，避免同时重写 dist，或操作相同镜像标签。
  const lock = join(workspace, ".cache", "release.lock");
  await mkdir(join(workspace, ".cache"), { recursive: true });
  try {
    await mkdir(lock);
  } catch {
    throw new Error(
      "已有本机发布/验收在运行；确认进程结束后可删除 .cache/release.lock 再试",
    );
  }
  let anonymous: string | undefined;
  let snapshot: string | undefined;
  let remoteTagExists = false;
  try {
    if (!verifyOnly) {
      const status = await execute(["git", "status", "--porcelain"], {
        quiet: true,
      });
      if (status)
        throw new Error(
          "工作区有未提交修改，请先提交；仅验收可使用 --verify-only",
        );
      await execute(["gh", "auth", "status"]);
      await execute(["bun", "scripts/release-auth.ts"]);
      // 提前检查源码已在远端，避免镜像成功后 Release 无法绑定同一提交。
      const remoteRevision = await execute(
        [
          "gh",
          "api",
          `repos/${repository}/commits/${revision}`,
          "--jq",
          ".sha",
        ],
        { quiet: true },
      );
      if (remoteRevision !== revision)
        throw new Error("请先将当前提交推送 GitHub");
      const releases = JSON.parse(
        await execute(
          ["gh", "api", `repos/${repository}/releases?per_page=100`],
          { quiet: true },
        ),
      ) as { tag_name: string; draft: boolean; target_commitish: string }[];
      const existing = releases.find((item) => item.tag_name === version);
      if (existing && !existing.draft)
        throw new Error(
          "该版本已正式发布，请提升版本；不能覆盖已发布镜像和附件",
        );
      if (existing && existing.target_commitish !== revision)
        throw new Error("同名草稿指向其他提交，请先核实草稿");
      const tag = await execute(
        [
          "git",
          "ls-remote",
          "origin",
          `refs/tags/${version}`,
          `refs/tags/${version}^{}`,
        ],
        { quiet: true },
      );
      if (
        tag &&
        !tag.split("\n").some((line) => line.split(/\s+/)[0] === revision)
      )
        throw new Error("远端同名标签指向其他提交，不能覆盖");
      remoteTagExists = Boolean(tag);
      console.log(
        "请确保 Docker 已登录 GHCR 和腾讯云；推送失败将保留草稿，重跑同版本即可重试。",
      );
    }
    // 快照排除所有被 Git 忽略的本机数据；Bun/Vite 子进程也无法重新读取开发 .env。
    snapshot = await mkdtemp(join(tmpdir(), "minmd-release-source-"));
    const files = await execute(
      ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { quiet: true },
    );
    for (const file of new Set(files.split("\0").filter(Boolean))) {
      if (
        /^(?:\.git|node_modules|dist|runtime|logs|backups?)(?:\/|$)/.test(
          file,
        ) ||
        (/(?:^|\/)\.env(?:$|\.)/.test(file) && !file.endsWith(".example"))
      )
        continue;
      const destination = resolve(snapshot, file);
      if (!destination.startsWith(`${snapshot}/`))
        throw new Error("源码路径越界");
      await mkdir(dirname(destination), { recursive: true });
      try {
        await cp(join(workspace, file), destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const isolated: Record<string, string | undefined> = { ...process.env };
    // 工具登录、网络及 PATH 沿用，项目配置从空环境开始，由测试显式注入。
    for (const template of [".env.example", ".env"]) {
      const path = join(workspace, template);
      if (await Bun.file(path).exists())
        for (const line of (await Bun.file(path).text()).split("\n")) {
          const name = line.match(/^\s*(?:#\s*)?([A-Z_][A-Z0-9_]*)=/)?.[1];
          if (name) isolated[name] = undefined;
        }
    }
    for (const name of Object.keys(isolated))
      if (
        /^(?:VITE_|TEST_|AUTH_TEST_|DEBUG_TEST_|DEPLOY_RUNTIME_|RUNTIME_PROCESS_TEST|RELEASE_REGISTRY_)/.test(
          name,
        )
      )
        isolated[name] = undefined;
    const work: Run = (args, settings = {}) =>
      execute(args, {
        ...settings,
        cwd: snapshot,
        env: { ...isolated, ...settings.env },
      });
    await work(["bun", "install", "--frozen-lockfile"]);
    const localNetwork = {
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
      http_proxy: "",
      https_proxy: "",
      all_proxy: "",
    };
    await work(["bun", "run", "check"], { env: localNetwork });
    // 两种 Linux 架构共用纯 JS / 静态产物；原生依赖仍在各目标架构安装。
    await work(["bun", "run", "build"], {
      env: { NODE_OPTIONS: "--max-old-space-size=4096" },
    });
    for (const arch of architectures) {
      const directory = join(snapshot, ".cache", "release-dependencies", arch);
      await prepareDependencyManifests(snapshot, directory);
      await work(dependencyInstall(directory, arch));
      for (const target of targets)
        await work(imageBuild(target, arch, version, revision));
    }
    await work(["bun", "scripts/release-verify.ts", version], {
      env: localNetwork,
    });
    const output = join(workspace, "dist", "release", version);
    await mkdir(output, { recursive: true });
    for (const [index, prefix] of prefixes.entries()) {
      await work([
        "sh",
        "deploy/scripts/package-release.sh",
        prefix,
        version,
        join(output, `minmd-${version}${index ? "-china" : ""}.tar.gz`),
        repository,
        index ? "china" : "official",
      ]);
    }
    // 打包及构建不得悄悄改变将要发布的源码（包括许可证清单）。
    if (
      !verifyOnly &&
      (await execute(["git", "status", "--porcelain"], { quiet: true }))
    )
      throw new Error("构建改变了源码，请提交这些变化后重新发布");
    if (verifyOnly) {
      console.log(`仅验收完成：${output}；未推送镜像、标签或创建 Release`);
      return;
    }
    if (
      (await execute(["git", "rev-parse", "HEAD"], { quiet: true })) !==
      revision
    )
      throw new Error("验收期间源码提交发生变化，请重新发布");
    // Draft 是断点；所有镜像和附件通过后才对外发布，失败时不更新 latest。
    const releaseData = JSON.parse(
      await execute(
        ["gh", "api", `repos/${repository}/releases?per_page=100`],
        { quiet: true },
      ),
    ) as { tag_name: string }[];
    if (!releaseData.some((item) => item.tag_name === version)) {
      await execute([
        "gh",
        "release",
        "create",
        version,
        "--repo",
        repository,
        "--draft",
        "--target",
        revision,
        "--title",
        `MinMD ${version}`,
        "--notes",
        "下载部署包，解压后执行 ./minmd.sh install。支持已有反代、自动 HTTPS 和 IP 直连；国内可使用 install-china.sh。",
      ]);
    }
    for (const target of targets) {
      for (const arch of architectures) {
        const local = `minmd-release-${target}:${version}-${arch}`;
        for (const prefix of prefixes) {
          const destination = `${prefix}-${target}:${version}-${arch}`;
          await execute(["docker", "tag", local, destination]);
          await retry(() =>
            execute(["docker", "push", destination], { timeout: 300000 }),
          );
        }
      }
      for (const prefix of prefixes) {
        const image = `${prefix}-${target}:${version}`;
        await retry(() =>
          execute(
            [
              "docker",
              "buildx",
              "imagetools",
              "create",
              "--tag",
              image,
              ...architectures.map((arch) => `${image}-${arch}`),
            ],
            { timeout: 180000 },
          ),
        );
      }
    }
    anonymous = await mkdtemp(join(tmpdir(), "minmd-release-anonymous-"));
    await writeFile(join(anonymous, "config.json"), "{}");
    for (const prefix of prefixes)
      for (const target of targets) {
        let raw = "";
        await retry(async () => {
          raw = await execute(
            [
              "docker",
              "--config",
              anonymous!,
              "manifest",
              "inspect",
              `${prefix}-${target}:${version}`,
            ],
            { quiet: true, timeout: 120000 },
          );
          checkManifest(raw);
        });
      }
    const attachments = ["", "-china"]
      .flatMap((suffix) => [
        `minmd-${version}${suffix}.tar.gz`,
        `minmd-${version}${suffix}.tar.gz.sha256`,
      ])
      .concat([
        "install.sh",
        "release.env",
        "install-china.sh",
        "release-china.env",
      ]);
    await retry(() =>
      execute(
        [
          "gh",
          "release",
          "upload",
          version,
          "--repo",
          repository,
          ...attachments.map((file) => join(output, file)),
          "--clobber",
        ],
        { timeout: 300000 },
      ),
    );
    // 发布标签显式绑定验收的提交；不依赖当前分支的后续变化。
    if (!remoteTagExists)
      await execute([
        "git",
        "push",
        "origin",
        `${revision}:refs/tags/${version}`,
      ]);
    await execute([
      "gh",
      "release",
      "edit",
      version,
      "--repo",
      repository,
      "--draft=false",
      ...(/^v\d+\.\d+\.\d+$/.test(version) ? ["--latest"] : ["--prerelease"]),
    ]);
    console.log(
      `发布完成：https://github.com/${repository}/releases/tag/${version}`,
    );
  } finally {
    if (anonymous) await rm(anonymous, { recursive: true, force: true });
    if (snapshot) await rm(snapshot, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
if (import.meta.main) {
  try {
    const pkg = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as { version: string };
    await release(options(process.argv.slice(2), pkg.version));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "发布失败");
    process.exitCode = 1;
  }
}
