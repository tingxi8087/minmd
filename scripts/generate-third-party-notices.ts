import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";

type Manifest = {
  name: string;
  version: string;
  license?: unknown;
  author?: unknown;
  repository?: unknown;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: string[];
};
type Override = {
  name: string;
  version: string;
  file: string;
  source: string;
  ref?: string;
  resolution?: string;
};
const root = resolve(import.meta.dir, "..");
const overrides = JSON.parse(
  await readFile(
    join(root, "docs/licenses/package-overrides/sources.json"),
    "utf8",
  ),
) as Override[];
const packages = new Map<string, { manifest: Manifest; directory: string }>();
async function findPackage(
  name: string,
  from: string,
): Promise<string | undefined> {
  for (let directory = from; ;) {
    const path = join(directory, "node_modules", name, "package.json");
    try {
      await stat(path);
      return await realpath(path);
    } catch {
      /* 按Node解析规则向父目录查找。 */
    }
    const parent = dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}
async function visit(path: string) {
  path = await realpath(path);
  if (packages.has(path)) return;
  const manifest = JSON.parse(await readFile(path, "utf8")) as Manifest;
  const directory = dirname(path);
  packages.set(path, { manifest, directory });
  for (const name of Object.keys({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  })) {
    const dependency = await findPackage(name, directory);
    if (dependency) await visit(dependency);
    else if (manifest.dependencies?.[name])
      throw new Error(`${manifest.name}的依赖${name}未安装，不能生成完整通知`);
  }
}
const rootManifest = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
) as Manifest;
const manifests = [join(root, "package.json")];
for (const workspace of rootManifest.workspaces ?? []) {
  for await (const file of new Bun.Glob(`${workspace}/package.json`).scan({
    cwd: root,
    absolute: true,
  }))
    manifests.push(file);
}
for (const file of manifests) {
  const manifest = JSON.parse(await readFile(file, "utf8")) as Manifest;
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    const dependency = await findPackage(name, dirname(file));
    if (!dependency) throw new Error(`${manifest.name}的依赖${name}未安装`);
    await visit(dependency);
  }
}
const lockHash = createHash("sha256")
  .update(await readFile(join(root, "bun.lock")))
  .digest("hex");
const sections = [
  "MinMD 第三方版权及许可证全文",
  `bun.lock SHA-256: ${lockHash}`,
  "范围：所有工作区生产依赖及其已安装的传递、可选和同伴依赖；可能保守包含构建期依赖。项目自有工作区由根LICENSE覆盖。",
  "许可声明及版权全文来自已安装发布包；少数发布包未附全文时，使用docs/licenses/package-overrides/sources.json中逐版本核实并保留的证据。依赖升级需重新生成，不能沿用旧版本通知。",
  "双许可证组件采用许可表达式中的宽松分支：JSZip选择MIT；相关许可原文仍完整保留。",
];
const inventory: {
  name: string;
  version: string;
  license: unknown;
  sources: string[];
  licenseFiles: string[];
  hashes: string[];
}[] = [];
for (const { manifest: p, directory } of [...packages.values()].sort(
  (a, b) =>
    a.manifest.name.localeCompare(b.manifest.name) ||
    a.manifest.version.localeCompare(b.manifest.version) ||
    a.directory.localeCompare(b.directory),
)) {
  if (!relative(root, directory).includes("node_modules")) continue;
  const files = (await readdir(directory)).filter((file) =>
    /^(licen[cs]e|copying|notice|copyright)(\.|$|-)/i.test(file),
  );
  const contents: { source: string; text: string }[] = [];
  for (const file of files) {
    const path = join(directory, file);
    if ((await stat(path)).isDirectory()) {
      for await (const child of new Bun.Glob("**/*").scan({
        cwd: path,
        onlyFiles: true,
      }))
        contents.push({
          source: `npm:${p.name}@${p.version}/${file}/${child}`,
          text: await readFile(join(path, child), "utf8"),
        });
    } else
      contents.push({
        source: `npm:${p.name}@${p.version}/${file}`,
        text: await readFile(path, "utf8"),
      });
  }
  if (!contents.length) {
    const override = overrides.find(
      (item) => item.name === p.name && item.version === p.version,
    );
    if (!override)
      throw new Error(
        `${p.name}@${p.version}缺少许可全文，需核实后新增逐版本证据`,
      );
    contents.push({
      source: override.source,
      text:
        (override.resolution ? `${override.resolution}\n\n` : "") +
        (await readFile(
          join(root, "docs/licenses/package-overrides", override.file),
          "utf8",
        )),
    });
  }
  sections.push(
    `\n${"=".repeat(80)}\n${p.name}@${p.version}\n声明许可: ${typeof p.license === "string" ? p.license : (JSON.stringify(p.license) ?? "未在清单声明，见原许可记录")}\n作者声明: ${JSON.stringify(p.author) ?? "见以下原始版权文本"}\n仓库声明: ${JSON.stringify(p.repository) ?? "未提供"}`,
  );
  for (const content of contents)
    sections.push(`\n原文来源: ${content.source}\n${content.text.trimEnd()}\n`);
  inventory.push({
    name: p.name,
    version: p.version,
    license: p.license ?? null,
    sources: contents.map((item) => item.source),
    licenseFiles: files,
    hashes: contents.map((item) =>
      createHash("sha256").update(item.text).digest("hex"),
    ),
  });
}
sections.push(
  "\n" +
    (await readFile(
      join(root, "docs/licenses/pptx-renderer-notices.txt"),
      "utf8",
    )),
);
const generated = sections.join("\n") + "\n";
const manifest =
  JSON.stringify({ lockHash, packages: inventory }, null, 2) + "\n";
for (const [file, text] of [
  ["THIRD_PARTY_NOTICES.txt", generated],
  ["docs/licenses/third-party-manifest.json", manifest],
]) {
  const target = join(root, file!);
  if (process.argv.includes("--check")) {
    if ((await Bun.file(target).text()) !== text)
      throw new Error(
        `${file}已过期，请运行 bun scripts/generate-third-party-notices.ts`,
      );
  } else await Bun.write(target, text!);
}
console.log(
  `第三方通知核实完成：${inventory.length}个发布包实例，${Buffer.byteLength(generated)}字节，锁文件校验${lockHash.slice(0, 12)}。`,
);
