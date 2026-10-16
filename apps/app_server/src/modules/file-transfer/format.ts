import { z } from "zod";
import type { JSONContent } from "@tiptap/core";
import { version } from "../../../../../package.json";
import type { TransferLimits } from "../../../../../config/file-transfer";
import { AppError } from "../../../../../system/server/src/errors";
import {
  documentSchema,
  normalizeDocument,
} from "../collaboration/document-schema";

export const transferVersion = version;
export const invalidPackage = (
  message = "压缩包无效或不是受支持的 minmd 导出包",
) => new AppError("TRANSFER_INVALID", message, 400);
export const packagePath = (input: string) => {
  if (
    !input ||
    input.length > 8192 ||
    /[\\\x00-\x1f\x7f:]/.test(input) ||
    input.startsWith("/") ||
    input.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw invalidPackage("压缩包包含非法路径");
  return input;
};
const path = z
  .string()
  .min(1)
  .max(8192)
  .refine((value) => {
    try {
      packagePath(value);
      return true;
    } catch {
      return false;
    }
  });
const id = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
export const manifestSchema = z
  .object({
    format: z.literal("minmd-transfer"),
    version: z.literal(1),
    appVersion: z.literal(transferVersion),
    mode: z.enum(["complete", "markdown"]),
    exportedAt: timestamp,
    sourceOrigin: z
      .string()
      .url()
      .refine(
        (value) =>
          ["http:", "https:"].includes(new URL(value).protocol) &&
          new URL(value).origin === value,
      ),
    entries: z
      .array(
        z
          .object({
            id,
            parentId: id.nullable(),
            kind: z.enum([
              "folder",
              "doc",
              "sheet",
              "slide",
              "pdf",
              "image",
              "video",
            ]),
            name: z.string().trim().min(1).max(200),
            position: z.number().finite(),
            createdAt: timestamp,
            updatedAt: timestamp,
            schemaVersion: z.literal(1),
            contentPath: path.nullable(),
            assetId: id.nullable(),
          })
          .strict(),
      )
      .min(1),
    assets: z.array(
      z
        .object({
          id,
          path,
          filename: z.string().min(1).max(200),
          mime: z.enum([
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/gif",
            "application/pdf",
            "video/mp4",
            "video/webm",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          ]),
          size: z.number().int().positive(),
          checksum: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    ),
  })
  .strict();
export type TransferManifest = z.infer<typeof manifestSchema>;
export type TransferEntry = TransferManifest["entries"][number];
export type TransferAsset = TransferManifest["assets"][number];

export function parseManifest(
  input: unknown,
  limits: TransferLimits,
): TransferManifest {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success)
    throw invalidPackage(
      "清单格式、应用版本或内容版本不兼容，请使用相同版本的 minmd",
    );
  const data = parsed.data;
  if (
    data.entries.length > limits.FILE_TRANSFER_MAX_FILES ||
    data.assets.length + data.entries.length + 1 >
      limits.FILE_TRANSFER_MAX_ENTRIES
  )
    throw new AppError("TRANSFER_TOO_LARGE", "压缩包文件数量超过限制", 413);
  const entries = new Map(data.entries.map((entry) => [entry.id, entry]));
  const assetIds = new Set(data.assets.map((asset) => asset.id));
  const paths = new Set(["manifest.json"]);
  if (
    entries.size !== data.entries.length ||
    assetIds.size !== data.assets.length
  )
    throw invalidPackage("清单包含重复标识");
  const addPath = (value: string) => {
    if (paths.has(value)) throw invalidPackage("清单包含重复文件路径");
    paths.add(value);
  };
  for (const asset of data.assets) {
    addPath(asset.path);
    if (asset.size > limits.FILE_TRANSFER_MAX_BYTES)
      throw new AppError("TRANSFER_TOO_LARGE", "附件超过上传限制", 413);
  }
  for (const entry of data.entries) {
    const seen = new Set([entry.id]);
    let parent = entry.parentId;
    let depth = 1;
    while (parent) {
      const row = entries.get(parent);
      if (!row || !["doc", "folder"].includes(row.kind) || seen.has(parent))
        throw invalidPackage("文件树包含循环、缺失或无效的父节点");
      seen.add(parent);
      parent = row.parentId;
      if (++depth > limits.FILE_TRANSFER_MAX_DEPTH)
        throw invalidPackage("目录嵌套超过限制");
    }
    if (["doc", "sheet"].includes(entry.kind)) {
      if (!entry.contentPath || entry.assetId)
        throw invalidPackage("正文清单不完整");
      const extension =
        data.mode === "complete"
          ? ".json"
          : entry.kind === "doc"
            ? ".md"
            : ".xlsx";
      if (!entry.contentPath.endsWith(extension))
        throw invalidPackage("正文文件类型与清单不匹配");
      addPath(entry.contentPath);
    } else if (entry.kind === "folder") {
      if (entry.contentPath || entry.assetId)
        throw invalidPackage("文件夹不能包含正文数据");
    } else if (
      entry.contentPath ||
      !entry.assetId ||
      !assetIds.has(entry.assetId)
    )
      throw invalidPackage("原文件附件缺失");
  }
  if (paths.size > limits.FILE_TRANSFER_MAX_ENTRIES)
    throw invalidPackage("条目数量超过限制");
  return data;
}

/** ProseMirror 默认会忽略未知属性；完整包在归一化前严格检查，避免样式被静默丢弃。 */
export function completeDocument(input: JSONContent): JSONContent {
  let count = 0;
  const attrs = (
    value: Record<string, unknown> | undefined,
    allowed: Record<string, unknown> | undefined,
  ) => {
    if (
      value &&
      Object.keys(value).some((key) => !Object.hasOwn(allowed ?? {}, key))
    )
      throw invalidPackage("文档包含当前版本不支持的属性");
  };
  const visit = (node: JSONContent, depth: number) => {
    if (
      depth > 64 ||
      ++count > 100000 ||
      !node ||
      typeof node !== "object" ||
      typeof node.type !== "string"
    )
      throw invalidPackage("文档节点无效或超过规模限制");
    if (
      Object.keys(node).some(
        (key) => !["type", "attrs", "content", "text", "marks"].includes(key),
      )
    )
      throw invalidPackage("文档节点包含未知字段");
    const type = documentSchema.nodes[node.type];
    if (!type) throw invalidPackage("文档包含不支持的节点");
    attrs(node.attrs, type.spec.attrs);
    if (node.marks !== undefined && !Array.isArray(node.marks))
      throw invalidPackage();
    for (const mark of node.marks ?? []) {
      const type = documentSchema.marks[mark.type];
      if (
        !type ||
        Object.keys(mark).some((key) => !["type", "attrs"].includes(key))
      )
        throw invalidPackage("文档包含不支持的文本样式");
      attrs(mark.attrs, type.spec.attrs);
    }
    if (node.content !== undefined && !Array.isArray(node.content))
      throw invalidPackage();
    node.content?.forEach((child) => visit(child, depth + 1));
  };
  visit(input, 0);
  return normalizeDocument(input);
}

export function rewriteDocument(
  input: JSONContent,
  fileIds: ReadonlyMap<string, string>,
  assetIds: ReadonlyMap<string, string>,
  sourceOrigin: string,
  preserveUnmappedReferences = false,
): JSONContent {
  const result = structuredClone(input);
  const link = (href: string) => {
    const match =
      /^(?:https?:\/\/[^/]+\/)?#\/(document|preview)\/([^?#/]+)(.*)$/.exec(
        href,
      );
    if (
      !match ||
      (href.startsWith("http") && new URL(href).origin !== sourceOrigin)
    )
      return href;
    let oldId: string;
    try {
      oldId = decodeURIComponent(match[2]!);
    } catch {
      return href;
    }
    const id = fileIds.get(oldId);
    return id
      ? `#/${match[1]}/${id}${match[3]}`
      : href.startsWith("#")
        ? `${sourceOrigin}/${href}`
        : href;
  };
  const visit = (node: JSONContent) => {
    if (node.type === "image") {
      const old = node.attrs?.assetId;
      const src = node.attrs?.src;
      const fromUrl =
        typeof src === "string"
          ? /^\/api\/app\/assets\/([0-9a-f-]{36})$/.exec(src)?.[1]
          : undefined;
      const key = typeof old === "string" && old ? old : fromUrl;
      if (key) {
        const id = assetIds.get(key);
        if (!id) throw invalidPackage("正文图片附件缺失");
        node.attrs = {
          ...node.attrs,
          assetId: id,
          src: `/api/app/assets/${id}`,
        };
      } else if (typeof src !== "string" || !/^https?:\/\//.test(src))
        throw invalidPackage("正文图片缺少合法附件引用");
    }
    if (
      node.type === "documentReference" &&
      typeof node.attrs?.id === "string"
    ) {
      const old = node.attrs.id;
      const mapped = fileIds.get(old);
      if (mapped) node.attrs.id = mapped;
      else if (!preserveUnmappedReferences) {
        node.type = "text";
        node.text = String(node.attrs.name || "未命名文档");
        delete node.attrs;
        node.marks = [
          {
            type: "link",
            attrs: {
              href: `${sourceOrigin}/#/document/${encodeURIComponent(old)}`,
            },
          },
        ];
      }
    }
    for (const mark of node.marks ?? [])
      if (mark.type === "link" && typeof mark.attrs?.href === "string")
        mark.attrs.href = link(mark.attrs.href);
    node.content?.forEach(visit);
  };
  visit(result);
  return result;
}

/** 按同级 position 深度优先建立树，不能让子项的较小 position 改变根目录顺序。 */
export function orderTransferEntries(
  entries: TransferEntry[],
): TransferEntry[] {
  const children = new Map<string | null, TransferEntry[]>();
  for (const entry of entries) {
    const group = children.get(entry.parentId) ?? [];
    group.push(entry);
    children.set(entry.parentId, group);
  }
  const result: TransferEntry[] = [];
  const visit = (parent: string | null) => {
    for (const entry of (children.get(parent) ?? []).sort(
      (a, b) => a.position - b.position || a.id.localeCompare(b.id),
    )) {
      result.push(entry);
      visit(entry.id);
    }
  };
  visit(null);
  return result;
}

export const safeFilename = (name: string) =>
  Array.from(
    name
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
      .replace(/^\.+$/, "_")
      .replace(/[. ]+$/, "")
      .normalize("NFC"),
  )
    .slice(0, 160)
    .join("") || "未命名文件";
/** 同时预留正文路径与目录路径，避免 foo.md 文件和 foo.md/ 目录冲突。 */
export function portablePaths(
  rows: { id: string; parentId: string | null; name: string; kind: string }[],
  extensions: ReadonlyMap<string, string>,
) {
  const ids = new Set(rows.map((row) => row.id));
  const parents = new Set(
    rows.flatMap((row) => (row.parentId ? [row.parentId] : [])),
  );
  const result = new Map<string, string>(),
    used = new Set<string>();
  const get = (row: (typeof rows)[number]): string => {
    if (result.has(row.id)) return result.get(row.id)!;
    const parent =
      row.parentId && ids.has(row.parentId)
        ? rows.find((item) => item.id === row.parentId)
        : undefined;
    const directory = parent ? `${get(parent)}/` : "files/";
    const extension =
      row.kind === "doc"
        ? ".md"
        : row.kind === "sheet"
          ? ".xlsx"
          : (extensions.get(row.id) ?? "");
    let stem = safeFilename(row.name);
    if (
      !["doc", "sheet", "folder"].includes(row.kind) &&
      extension &&
      stem.toLowerCase().endsWith(extension.toLowerCase())
    )
      stem = stem.slice(0, -extension.length) || "文件";
    let base = directory + stem,
      index = 1;
    const reserved = () =>
      row.kind === "folder"
        ? [base]
        : [base + extension, ...(parents.has(row.id) ? [base] : [])];
    while (reserved().some((path) => used.has(path.toLowerCase())))
      base = `${directory}${stem} (${index++})`;
    reserved().forEach((path) => used.add(path.toLowerCase()));
    result.set(row.id, base);
    return base;
  };
  rows.forEach(get);
  return result;
}
