import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import type { JSONContent } from "@tiptap/core";
import type { Sheet } from "@fortune-sheet/core";
import {
  parseMarkdownDocument,
  createMarkdownManager,
} from "../../../../../shared/document/markdownImport";
import { exportDocument } from "../../../../../shared/document/markdownExport";
import {
  importXlsx,
  exportXlsx,
} from "../../../../../shared/spreadsheet/exchange";
import { prepareSheet } from "../collaboration/sheet-room";
import { validateZipDirectory, validateAsset } from "../assets/validate";
import { validateMediaAsset } from "../assets/media-validation";
import { hashFile, type ArchiveFile } from "./archive";
import {
  completeDocument,
  invalidPackage,
  packagePath,
  type TransferEntry,
  type TransferManifest,
} from "./format";

export type PreparedContent = {
  projection: Record<string, unknown>;
  engineState?: Record<string, unknown>;
};
export type PreparedPackage = {
  manifest: TransferManifest;
  contents: Map<string, string>;
  slides: Map<string, number>;
  archive: Map<string, ArchiveFile>;
};
export function visitDocument(
  node: JSONContent,
  callback: (node: JSONContent) => void,
) {
  callback(node);
  node.content?.forEach((child) => visitDocument(child, callback));
}
const relativeTarget = (source: string, value: string): string | undefined => {
  if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(value)) return;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value.split(/[?#]/)[0]!);
  } catch {
    throw invalidPackage("引用路径编码无效");
  }
  return packagePath(
    posix.normalize(posix.join(posix.dirname(source), decoded)),
  );
};

/** 先检查所有内容与附件，再允许调用方开始写入正式数据。 */
export async function preparePackage(
  manifest: TransferManifest,
  archive: Map<string, ArchiveFile>,
  signal?: AbortSignal,
): Promise<PreparedPackage> {
  const expected = new Set([
    "manifest.json",
    ...manifest.assets.map((asset) => asset.path),
    ...manifest.entries.flatMap((entry) =>
      entry.contentPath ? [entry.contentPath] : [],
    ),
  ]);
  if (
    expected.size !== archive.size ||
    [...expected].some((path) => !archive.has(path))
  )
    throw invalidPackage("压缩包包含未声明的文件或缺少清单引用");
  const slides = new Map<string, number>();
  for (const asset of manifest.assets) {
    signal?.throwIfAborted();
    const resource = archive.get(asset.path)!;
    if (
      resource.size !== asset.size ||
      (await hashFile(resource.path, signal)) !== asset.checksum
    )
      throw invalidPackage("附件大小或校验和不匹配");
    const bytes = await readFile(resource.path);
    const parsed = asset.mime.endsWith("presentationml.presentation")
      ? await validateAsset(bytes, asset.filename, asset.mime)
      : validateMediaAsset(bytes, asset.filename, asset.mime);
    slides.set(asset.id, parsed.slides);
  }
  const contents = new Map<string, string>();
  const usedAssets = new Set<string>();
  const resources = new Map(
    manifest.assets.map((asset) => [asset.path, asset]),
  );
  for (const entry of manifest.entries) {
    signal?.throwIfAborted();
    if (!entry.contentPath) continue;
    const file = archive.get(entry.contentPath)!;
    if (entry.kind === "doc") {
      const text = await Bun.file(file.path).text();
      let input: JSONContent;
      try {
        input =
          manifest.mode === "complete"
            ? (JSON.parse(text) as JSONContent)
            : parseMarkdownDocument(text);
      } catch {
        throw invalidPackage("文档内容无法解析");
      }
      if (manifest.mode === "markdown")
        visitDocument(input, (node) => {
          if (node.type !== "image" || typeof node.attrs?.src !== "string")
            return;
          const target = relativeTarget(entry.contentPath!, node.attrs.src);
          if (!target) return;
          const asset = resources.get(target);
          if (!asset || !asset.mime.startsWith("image/"))
            throw invalidPackage("Markdown 引用的本地图片缺失");
          node.attrs = {
            ...node.attrs,
            assetId: asset.id,
            src: `/api/app/assets/${asset.id}`,
          };
        });
      const projection = completeDocument(input);
      // 预检图片闭合，不能等事务写到一半才发现缺附件。
      visitDocument(projection, (node) => {
        if (node.type !== "image") return;
        const key = node.attrs?.assetId;
        if (typeof key === "string") usedAssets.add(key);
        const src = node.attrs?.src;
        if (
          key
            ? !manifest.assets.some(
                (asset) => asset.id === key && asset.mime.startsWith("image/"),
              )
            : typeof src !== "string" || !/^https?:\/\//.test(src)
        )
          throw invalidPackage("文档图片引用无效或附件缺失");
      });
      const path = `${file.path}.prepared`;
      await Bun.write(path, JSON.stringify({ projection }));
      contents.set(entry.id, path);
    } else if (entry.kind === "sheet") {
      let input: Record<string, unknown>;
      if (manifest.mode === "complete") {
        try {
          input = JSON.parse(await Bun.file(file.path).text()) as Record<
            string,
            unknown
          >;
        } catch {
          throw invalidPackage("表格内容无法解析");
        }
      } else {
        const bytes = await readFile(file.path);
        validateZipDirectory(bytes);
        const sheets = await importXlsx(
          new File([new Uint8Array(bytes)], "表格.xlsx"),
          entry.id,
          entry.name,
        );
        input = { sheets };
      }
      if (
        !input ||
        typeof input !== "object" ||
        Object.keys(input).some((key) => key !== "sheets")
      )
        throw invalidPackage("表格包含未知字段");
      const path = `${file.path}.prepared`;
      await Bun.write(
        path,
        JSON.stringify(
          prepareSheet(
            JSON.parse(JSON.stringify(input)) as Record<string, unknown>,
          ),
        ),
      );
      contents.set(entry.id, path);
    }
  }
  for (const entry of manifest.entries)
    if (entry.assetId) {
      usedAssets.add(entry.assetId);
      const asset = manifest.assets.find(
        (asset) => asset.id === entry.assetId,
      )!;
      const kind = asset.mime.endsWith("presentationml.presentation")
        ? "slide"
        : asset.mime === "application/pdf"
          ? "pdf"
          : asset.mime.startsWith("video/")
            ? "video"
            : "image";
      if (entry.kind !== kind) throw invalidPackage("原文件类型与清单不匹配");
    }
  if (manifest.assets.some((asset) => !usedAssets.has(asset.id)))
    throw invalidPackage("清单包含未引用的附件");
  return { manifest, contents, slides, archive };
}

export function remapMarkdownLinks(
  projection: JSONContent,
  entry: TransferEntry,
  manifest: TransferManifest,
  ids: ReadonlyMap<string, string>,
) {
  if (manifest.mode !== "markdown" || !entry.contentPath) return projection;
  const result = structuredClone(projection);
  const paths = new Map(
    manifest.entries.flatMap((item) => {
      const path =
        item.contentPath ??
        (item.assetId
          ? manifest.assets.find((asset) => asset.id === item.assetId)?.path
          : undefined);
      return path ? [[path, item] as const] : [];
    }),
  );
  visitDocument(result, (node) => {
    for (const mark of node.marks ?? [])
      if (mark.type === "link" && typeof mark.attrs?.href === "string") {
        const target = relativeTarget(entry.contentPath!, mark.attrs.href);
        const file = target ? paths.get(target) : undefined;
        if (file && ids.has(file.id))
          mark.attrs.href = `#/${file.kind === "doc" ? "document" : "preview"}/${ids.get(file.id)}${/[?#].*$/.exec(mark.attrs.href)?.[0] ?? ""}`;
      }
  });
  return result;
}

export async function portableContent(
  entry: TransferEntry,
  projection: Record<string, unknown>,
  manifest: TransferManifest,
) {
  if (entry.kind === "sheet")
    return Buffer.from(
      await (
        await exportXlsx(projection.sheets as Sheet[], entry.name)
      ).arrayBuffer(),
    );
  const json = exportDocument(projection as JSONContent);
  const assets = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  const entries = new Map(manifest.entries.map((item) => [item.id, item]));
  visitDocument(json, (node) => {
    if (node.type === "image" && typeof node.attrs?.assetId === "string") {
      const asset = assets.get(node.attrs.assetId);
      if (!asset) throw invalidPackage("导出文档图片缺少原附件");
      node.attrs.src = posix.relative(
        posix.dirname(entry.contentPath!),
        asset.path,
      );
    }
    for (const mark of node.marks ?? [])
      if (mark.type === "link" && typeof mark.attrs?.href === "string") {
        const match =
          /^(?:https?:\/\/[^/]+\/)?#\/(?:document|preview)\/([^?#/]+)(.*)$/.exec(
            mark.attrs.href,
          );
        if (
          !match ||
          (mark.attrs.href.startsWith("http") &&
            new URL(mark.attrs.href).origin !== manifest.sourceOrigin)
        )
          continue;
        let id: string;
        try {
          id = decodeURIComponent(match[1]!);
        } catch {
          continue;
        }
        const target = entries.get(id);
        if (target?.contentPath)
          mark.attrs.href =
            posix.relative(
              posix.dirname(entry.contentPath!),
              target.contentPath,
            ) + match[2];
        else if (target?.assetId)
          mark.attrs.href =
            posix.relative(
              posix.dirname(entry.contentPath!),
              assets.get(target.assetId)!.path,
            ) + match[2];
        else if (mark.attrs.href.startsWith("#"))
          mark.attrs.href = `${manifest.sourceOrigin}/${mark.attrs.href}`;
      }
  });
  return Buffer.from(createMarkdownManager().serialize(json));
}

export async function preparedContent(
  prepared: PreparedPackage,
  id: string,
): Promise<PreparedContent> {
  const path = prepared.contents.get(id);
  if (!path) throw invalidPackage("校验后的正文暂存文件缺失");
  return Bun.file(path).json() as Promise<PreparedContent>;
}
