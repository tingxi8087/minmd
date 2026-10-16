import { mkdir, cp, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export function dependencyInstall(directory: string, arch: string) {
  return [
    "bun",
    "install",
    "--cwd",
    directory,
    "--frozen-lockfile",
    "--linker",
    "hoisted",
    "--os",
    "linux",
    "--cpu",
    arch === "amd64" ? "x64" : "arm64",
    "--ignore-scripts",
  ];
}
/** 按锁文件准备目标平台依赖，不执行外部架构的安装脚本。Linux 镜像中仍执行依赖及运行检查。 */
export async function prepareDependencyManifests(
  source: string,
  directory: string,
) {
  const pkg = JSON.parse(
    await readFile(join(source, "package.json"), "utf8"),
  ) as {
    version?: string;
    workspaces: string[];
    patchedDependencies?: Record<string, string>;
  };
  const files = new Set([
    "bun.lock",
    ...Object.values(pkg.patchedDependencies ?? {}),
  ]);
  for (const pattern of pkg.workspaces) {
    for await (const file of new Bun.Glob(`${pattern}/package.json`).scan({
      cwd: source,
    }))
      files.add(file);
  }
  await mkdir(directory, { recursive: true });
  // 依赖缓存不随应用版本变化；实际应用 package.json 仍由源码单独复制进镜像。
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ ...pkg, version: "0.0.0" }, null, 2),
  );
  for (const file of files) {
    await mkdir(dirname(join(directory, file)), { recursive: true });
    await cp(join(source, file), join(directory, file));
  }
}
