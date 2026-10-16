import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dependencyInstall,
  prepareDependencyManifests,
} from "../scripts/release-dependencies";

test("本机按 Linux 目标架构安装 hoisted 依赖，不执行跨平台安装脚本", () => {
  for (const [arch, cpu] of [
    ["amd64", "x64"],
    ["arm64", "arm64"],
  ]) {
    const args = dependencyInstall("/temporary/dependencies", arch!);
    expect(args).toContain("--frozen-lockfile");
    expect(args[args.indexOf("--os") + 1]).toBe("linux");
    expect(args[args.indexOf("--cpu") + 1]).toBe(cpu);
    expect(args[args.indexOf("--linker") + 1]).toBe("hoisted");
    expect(args).toContain("--ignore-scripts");
  }
});
test("依赖清单由 workspace 和补丁配置发现，规范版本不修改源码与锁文件", async () => {
  const source = await mkdtemp(join(tmpdir(), "minmd-deps-unit-"));
  try {
    await mkdir(join(source, "modules/backend"), { recursive: true });
    await mkdir(join(source, "patches"));
    const pkg = {
      name: "example",
      version: "0.1.4",
      workspaces: ["modules/*"],
      patchedDependencies: { "demo@1.0.0": "patches/demo.patch" },
    };
    await writeFile(join(source, "package.json"), JSON.stringify(pkg));
    await writeFile(join(source, "bun.lock"), "locked-content");
    await writeFile(
      join(source, "modules/backend/package.json"),
      '{"name":"backend"}',
    );
    await writeFile(join(source, "patches/demo.patch"), "patch-content");
    const destination = join(source, "output");
    await prepareDependencyManifests(source, destination);
    const normalized = JSON.parse(
      await readFile(join(destination, "package.json"), "utf8"),
    ) as typeof pkg;
    expect(normalized).toEqual({ ...pkg, version: "0.0.0" });
    expect(await readFile(join(destination, "bun.lock"), "utf8")).toBe(
      "locked-content",
    );
    expect(
      await readFile(join(destination, "modules/backend/package.json"), "utf8"),
    ).toContain("backend");
    expect(
      await readFile(join(destination, "patches/demo.patch"), "utf8"),
    ).toBe("patch-content");
    expect(
      JSON.parse(await readFile(join(source, "package.json"), "utf8")),
    ).toEqual(pkg);
  } finally {
    await rm(source, { recursive: true, force: true });
  }
});
