import { and, eq, inArray, isNull, asc } from "drizzle-orm";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import type { Database } from "../../../../../system/server/src/database/client";
import type { TransferLimits } from "../../../../../config/file-transfer";
import { AppError } from "../../../../../system/server/src/errors";
import { files } from "../../database/schema/files";
import { assets } from "../../database/schema/assets";
import { fileContents } from "../../database/schema/contents";
import { requireFileAccess } from "../files/service";
import { requireAssetAccess } from "../assets/service";
import type { DocumentRooms } from "../collaboration/document-room";
import type { SheetRooms } from "../collaboration/sheet-room";
import { hashFile, writeArchive } from "./archive";
import {
  completeDocument,
  portablePaths,
  safeFilename,
  invalidPackage,
  parseManifest,
  transferVersion,
  type TransferManifest,
} from "./format";
import { portableContent } from "./payload";

type FileRow = typeof files.$inferSelect;
export type ExportInput = {
  ids: string[];
  mode: "complete" | "markdown";
  single: boolean;
};
export type TransferServices = {
  database: Database;
  rooms: DocumentRooms;
  sheetRooms: SheetRooms;
  assetDirectory: string;
  limits: TransferLimits;
  sourceOrigin: string;
};
function referencedAssets(
  value: unknown,
  result = new Set<string>(),
  depth = 0,
): Set<string> {
  if (depth > 64) throw invalidPackage("内容结构过深");
  if (!value || typeof value !== "object") return result;
  if (
    !Array.isArray(value) &&
    "assetId" in value &&
    typeof value.assetId === "string"
  )
    result.add(value.assetId);
  for (const child of Object.values(value))
    referencedAssets(child, result, depth + 1);
  return result;
}
export async function exportSelection(
  services: TransferServices,
  userId: string,
  spaceId: string,
  input: ExportInput,
) {
  const { database, limits } = services;
  if (input.ids.length > limits.FILE_TRANSFER_MAX_FILES)
    throw new AppError("TRANSFER_TOO_LARGE", "选择的文件数量超过限制", 413);
  const rows = new Map<string, FileRow>();
  for (const id of new Set(input.ids)) {
    const row = await requireFileAccess(database, userId, id);
    if (row.spaceId !== spaceId)
      throw new AppError("TRANSFER_FORBIDDEN", "选择的文件不在当前空间", 403);
    if (input.single && row.kind !== "doc")
      throw invalidPackage("单文档导出仅支持一份文档");
    rows.set(row.id, row);
  }
  if (input.single && rows.size !== 1)
    throw invalidPackage("单文档导出仅支持一份文档");
  let frontier = [...rows.keys()];
  while (!input.single && frontier.length) {
    const children = await database.db
      .select()
      .from(files)
      .where(
        and(
          eq(files.spaceId, spaceId),
          isNull(files.deletedAt),
          inArray(files.parentId, frontier),
        ),
      )
      .orderBy(asc(files.position), asc(files.id))
      .limit(limits.FILE_TRANSFER_MAX_FILES + 1);
    frontier = [];
    for (const row of children)
      if (!rows.has(row.id)) {
        rows.set(row.id, row);
        frontier.push(row.id);
      }
    if (rows.size > limits.FILE_TRANSFER_MAX_FILES)
      throw new AppError("TRANSFER_TOO_LARGE", "选择的文件数量超过限制", 413);
  }
  if (!rows.size) throw invalidPackage("请选择要导出的文件");
  // 在读取正文前验证整棵选中子树，不静默跳过不可访问的后代。
  for (const row of rows.values())
    await requireFileAccess(database, userId, row.id);
  return [...rows.values()];
}
export async function captureExport(
  services: TransferServices,
  userId: string,
  spaceId: string,
  input: ExportInput,
  directory: string,
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
) {
  const rows = await exportSelection(services, userId, spaceId, input);
  await mkdir(directory, { recursive: true });
  const allIds = new Set(rows.map((row) => row.id));
  let paths = new Map<string, string>();
  const manifest: TransferManifest = {
    format: "minmd-transfer",
    version: 1,
    appVersion: transferVersion,
    mode: input.mode,
    exportedAt: new Date().toISOString(),
    sourceOrigin: services.sourceOrigin,
    entries: rows.map((row) => ({
      id: row.id,
      parentId: row.parentId && allIds.has(row.parentId) ? row.parentId : null,
      kind: row.kind as TransferManifest["entries"][number]["kind"],
      name: row.name,
      position: row.position,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      schemaVersion: 1,
      contentPath: ["doc", "sheet"].includes(row.kind)
        ? input.mode === "complete"
          ? `contents/${row.id}.json`
          : `contents/${row.id}${row.kind === "doc" ? ".md" : ".xlsx"}`
        : null,
      assetId: null,
    })),
    assets: [],
  };
  const projections = new Map<string, string>();
  const sources: { name: string; path: string }[] = [];
  const captured = new Set<string>();
  const revisions = new Map<string, { revision: number; epoch: number }>();
  let size = 0;
  let done = 0;
  for (const row of rows) {
    signal.throwIfAborted();
    if (row.kind === "doc") await services.rooms.persistBarrier(row.id);
    if (row.kind === "sheet") await services.sheetRooms.persistBarrier(row.id);
    await services.database.db.transaction(async (tx) => {
      await requireFileAccess(tx, userId, row.id);
      if (row.kind === "folder") return;
      const [content] = await tx
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, row.id))
        .for("share");
      if (
        !content ||
        content.projectionRevision !== content.revision ||
        content.schemaVersion !== 1
      )
        throw new AppError(
          "TRANSFER_CONTENT_PENDING",
          "正文尚未就绪，请稍后重试",
          409,
        );
      revisions.set(row.id, {
        revision: content.revision,
        epoch: content.epoch,
      });
      if (row.kind === "doc") completeDocument(content.projection);
      const projection = structuredClone(content.projection);
      if (["doc", "sheet"].includes(row.kind)) {
        const serialized = JSON.stringify(projection);
        size += Buffer.byteLength(serialized);
        if (size > services.limits.FILE_TRANSFER_EXPANDED_BYTES)
          throw new AppError(
            "TRANSFER_TOO_LARGE",
            "正文和附件总容量超过限制",
            413,
          );
        const snapshot = join(directory, `${row.id}.snapshot.json`);
        await Bun.write(snapshot, serialized);
        projections.set(row.id, snapshot);
      }
      const entry = manifest.entries.find((entry) => entry.id === row.id)!;
      entry.updatedAt = new Date(
        Math.max(row.updatedAt.getTime(), content.updatedAt.getTime()),
      ).toISOString();
      if (!["doc", "sheet"].includes(row.kind)) {
        if (typeof projection.assetId !== "string")
          throw invalidPackage("文件原附件缺失");
        entry.assetId = projection.assetId;
      }
      const needed = referencedAssets(projection);
      const resources = needed.size
        ? await tx
            .select()
            .from(assets)
            .where(
              and(eq(assets.spaceId, spaceId), inArray(assets.id, [...needed])),
            )
            .for("share")
        : [];
      if (resources.length !== needed.size)
        throw invalidPackage("正文引用的附件缺失或不属于当前空间");
      for (const asset of resources) {
        await requireAssetAccess(tx, userId, asset);
        if (captured.has(asset.id)) continue;
        signal.throwIfAborted();
        size += asset.size;
        if (size > services.limits.FILE_TRANSFER_EXPANDED_BYTES)
          throw new AppError("TRANSFER_TOO_LARGE", "附件总容量超过限制", 413);
        const path = join(directory, asset.id);
        // 在附件行共享锁下复制，避免并发无引用附件清理删除原文件。
        await copyFile(join(services.assetDirectory, asset.storageKey), path);
        if ((await hashFile(path, signal)) !== asset.checksum)
          throw invalidPackage("原附件校验失败");
        const name = `assets/${asset.id}${extname(asset.filename).toLowerCase()}`;
        manifest.assets.push({
          id: asset.id,
          path: name,
          filename: asset.filename,
          mime: asset.mime as TransferManifest["assets"][number]["mime"],
          size: asset.size,
          checksum: asset.checksum,
        });
        captured.add(asset.id);
      }
    });
    progress(++done, rows.length);
  }
  paths = portablePaths(
    rows,
    new Map(
      manifest.entries.flatMap((entry) => {
        const asset = entry.assetId
          ? manifest.assets.find((asset) => asset.id === entry.assetId)
          : undefined;
        return asset
          ? [[entry.id, extname(asset.filename).toLowerCase()] as const]
          : [];
      }),
    ),
  );
  if (input.mode === "markdown")
    for (const entry of manifest.entries) {
      if (entry.contentPath)
        entry.contentPath = `${paths.get(entry.id)}${entry.kind === "doc" ? ".md" : ".xlsx"}`;
    }
  if (input.mode === "markdown")
    for (const asset of manifest.assets) {
      const primary = manifest.entries.find(
        (entry) => entry.assetId === asset.id,
      );
      if (primary)
        asset.path = `${paths.get(primary.id)}${extname(asset.filename).toLowerCase()}`;
    }
  sources.push(
    ...manifest.assets.map((asset) => ({
      name: asset.path,
      path: join(directory, asset.id),
    })),
  );
  parseManifest(manifest, services.limits);
  for (const entry of manifest.entries)
    if (entry.contentPath) {
      signal.throwIfAborted();
      const snapshot = projections.get(entry.id)!;
      if (input.mode === "complete") {
        sources.push({ name: entry.contentPath, path: snapshot });
        continue;
      }
      const projection = (await Bun.file(snapshot).json()) as Record<
        string,
        unknown
      >;
      const bytes = await portableContent(entry, projection, manifest);
      const path = join(directory, `${entry.id}.content`);
      await Bun.write(path, bytes);
      sources.push({ name: entry.contentPath, path });
    }
  const path = join(directory, "manifest.json");
  await Bun.write(path, JSON.stringify(manifest));
  sources.push({ name: "manifest.json", path });
  // 打包前再次授权，捕获后的内容和附件副本不再随源文件变化。
  for (const row of rows)
    await requireFileAccess(services.database, userId, row.id);
  return { manifest, sources, rows, paths, allIds, revisions };
}
export async function buildExport(
  services: TransferServices,
  userId: string,
  spaceId: string,
  input: ExportInput,
  directory: string,
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
) {
  const { manifest, sources, rows, paths, allIds } = await captureExport(
    services,
    userId,
    spaceId,
    input,
    directory,
    signal,
    progress,
  );
  if (input.single && input.mode === "markdown" && !manifest.assets.length) {
    const source = sources.find(
      (item) => item.name === manifest.entries[0]!.contentPath,
    )!;
    if (
      (await stat(source.path)).size > services.limits.FILE_TRANSFER_MAX_BYTES
    )
      throw new AppError("TRANSFER_TOO_LARGE", "导出文件容量超过限制", 413);
    return {
      manifest,
      download: source.path,
      downloadMime: "text/markdown;charset=utf-8",
      filename: `${safeFilename(rows[0]!.name)}.md`,
      sourceIds: [...allIds],
    };
  }
  const download = join(directory, "download.zip");
  await writeArchive(
    sources,
    download,
    services.limits,
    signal,
    input.mode === "markdown"
      ? rows
          .filter((row) => row.kind === "folder")
          .map((row) => paths.get(row.id)!)
      : [],
  );
  return {
    manifest,
    download,
    downloadMime: "application/zip",
    filename: `${safeFilename(input.single ? rows[0]!.name : "minmd-文件导出")}${input.mode === "complete" ? ".minmd.zip" : ".zip"}`,
    sourceIds: [...allIds],
  };
}
