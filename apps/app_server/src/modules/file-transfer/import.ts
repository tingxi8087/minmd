import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { copyFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { JSONContent } from "@tiptap/core";
import * as Y from "yjs";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import { AppError } from "../../../../../system/server/src/errors";
import { files } from "../../database/schema/files";
import { assets } from "../../database/schema/assets";
import { fileContents, fileVersions } from "../../database/schema/contents";
import { fileTransferImports } from "../../database/schema/file-transfers";
import { lockSpace, requireSpaceAccess } from "../spaces/service";
import { requireFileAccess } from "../files/service";
import { createFile, validateParent } from "../files/operations";
import { syncContentAssets } from "../assets/service";
import {
  createDocumentState,
  documentProjection,
} from "../collaboration/document-schema";
import {
  invalidPackage,
  orderTransferEntries,
  rewriteDocument,
  type TransferAsset,
  type TransferEntry,
} from "./format";
import {
  preparedContent,
  remapMarkdownLinks,
  type PreparedPackage,
} from "./payload";
import type { TransferServices } from "./export";

export type ImportInput = {
  parentId: string | null;
  replaceFileId: string | null;
  expectedRevision?: number;
  expectedEpoch?: number;
};
export async function authorizeImport(
  services: TransferServices,
  userId: string,
  spaceId: string,
  input: ImportInput,
) {
  if (input.replaceFileId) {
    const file = await requireFileAccess(
      services.database,
      userId,
      input.replaceFileId,
      { permission: "edit" },
    );
    if (file.spaceId !== spaceId || file.kind !== "doc")
      throw new AppError(
        "TRANSFER_FORBIDDEN",
        "目标不是当前空间的可编辑文档",
        403,
      );
    if (!input.expectedRevision || !input.expectedEpoch)
      throw invalidPackage("替换文档需要内容修订及世代");
  } else {
    await requireSpaceAccess(services.database, userId, spaceId);
    await services.database.db.transaction((tx) =>
      validateParent(tx, spaceId, input.parentId),
    );
    if (input.parentId)
      await requireFileAccess(services.database, userId, input.parentId, {
        permission: "edit",
      });
  }
}
export async function importReceipt(
  services: TransferServices,
  userId: string,
  batchId: string,
) {
  const [row] = await services.database.db
    .select()
    .from(fileTransferImports)
    .where(
      and(
        eq(fileTransferImports.id, batchId),
        eq(fileTransferImports.userId, userId),
      ),
    );
  return row;
}
async function uniqueName(
  tx: Transaction,
  spaceId: string,
  parentId: string | null,
  original: string,
) {
  const rows = await tx
    .select({ name: files.name })
    .from(files)
    .where(
      and(
        eq(files.spaceId, spaceId),
        isNull(files.deletedAt),
        parentId ? eq(files.parentId, parentId) : isNull(files.parentId),
      ),
    );
  const used = new Set(rows.map((row) => row.name));
  let name = original,
    index = 1;
  while (used.has(name)) {
    const suffix = ` (${index++})`;
    name = original.slice(0, 200 - suffix.length) + suffix;
  }
  return name;
}
export async function commitPackage(
  services: TransferServices,
  userId: string,
  spaceId: string,
  batchId: string,
  input: ImportInput,
  prepared: PreparedPackage,
  signal: AbortSignal,
  stagingDirectory: string,
  options?: {
    copy?: boolean;
    fingerprint?: string;
    beforeCreate?: (tx: Transaction) => Promise<void>;
  },
) {
  const old = await importReceipt(services, userId, batchId);
  if (old) {
    if (options?.fingerprint && old.requestFingerprint !== options.fingerprint)
      throw new AppError("BATCH_CONFLICT", "操作编号已用于其他复制请求", 409);
    return old.fileIds;
  }
  await authorizeImport(services, userId, spaceId, input);
  const { manifest } = prepared;
  if (
    input.replaceFileId &&
    (manifest.entries.length !== 1 || manifest.entries[0]!.kind !== "doc")
  )
    throw invalidPackage("此包包含多个文件，请通过文件列表的上传入口导入");
  const ids = new Map(
    manifest.entries.map((entry) => [
      entry.id,
      input.replaceFileId ?? crypto.randomUUID(),
    ]),
  );
  const assetIds = new Map(
    manifest.assets.map((asset) => [asset.id, crypto.randomUUID()]),
  );
  const staged = new Map<string, { descriptor: TransferAsset; path: string }>();
  await mkdir(services.assetDirectory, { recursive: true });
  await Bun.write(
    join(stagingDirectory, "pending-assets.json"),
    JSON.stringify([...assetIds.values()]),
  );
  try {
    for (const asset of manifest.assets) {
      signal.throwIfAborted();
      const path = join(services.assetDirectory, assetIds.get(asset.id)!);
      staged.set(asset.id, { descriptor: asset, path });
      await copyFile(prepared.archive.get(asset.path)!.path, path);
    }
    const insertAssets = async (tx: Transaction) => {
      for (const [oldId, { descriptor }] of staged) {
        signal.throwIfAborted();
        await tx.insert(assets).values({
          id: assetIds.get(oldId)!,
          spaceId,
          storageKey: assetIds.get(oldId)!,
          filename: descriptor.filename,
          mime: descriptor.mime,
          size: descriptor.size,
          checksum: descriptor.checksum,
          uploadedBy: userId,
          uploadedForFileId: input.replaceFileId,
        });
      }
    };
    const writeReceipt = async (tx: Transaction, fileIds: string[]) => {
      signal.throwIfAborted();
      await tx.insert(fileTransferImports).values({
        id: batchId,
        userId,
        spaceId,
        targetFileId: input.replaceFileId,
        fileIds,
        requestFingerprint: options?.fingerprint,
      });
    };
    const rewritten = async (entry: TransferEntry) =>
      rewriteDocument(
        remapMarkdownLinks(
          (await preparedContent(prepared, entry.id)).projection as JSONContent,
          entry,
          manifest,
          ids,
        ),
        ids,
        assetIds,
        manifest.sourceOrigin,
        options?.copy,
      );
    if (input.replaceFileId) {
      const projection = await rewritten(manifest.entries[0]!);
      await services.rooms.replaceDocument(
        input.replaceFileId,
        userId,
        {
          projection,
          expectedRevision: input.expectedRevision!,
          expectedEpoch: input.expectedEpoch!,
          source: "import",
        },
        {
          prepare: async (tx) => {
            signal.throwIfAborted();
            await insertAssets(tx);
          },
          completed: (tx) => writeReceipt(tx, [input.replaceFileId!]),
        },
      );
      return [input.replaceFileId];
    }
    return await services.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${batchId}, 91734))`,
      );
      const [existing] = await tx
        .select()
        .from(fileTransferImports)
        .where(
          and(
            eq(fileTransferImports.id, batchId),
            eq(fileTransferImports.userId, userId),
          ),
        );
      if (existing) {
        if (
          options?.fingerprint &&
          existing.requestFingerprint !== options.fingerprint
        )
          throw new AppError(
            "BATCH_CONFLICT",
            "操作编号已用于其他复制请求",
            409,
          );
        return existing.fileIds;
      }
      await lockSpace(tx, spaceId);
      await requireSpaceAccess(tx, userId, spaceId);
      await validateParent(tx, spaceId, input.parentId);
      if (input.parentId)
        await requireFileAccess(tx, userId, input.parentId, {
          permission: "edit",
        });
      await options?.beforeCreate?.(tx);
      const imported: string[] = [];
      // 先建立全树，保证正文引用和附件外键在写入时均有目标。
      for (const entry of orderTransferEntries(manifest.entries)) {
        signal.throwIfAborted();
        const parentId = entry.parentId
          ? ids.get(entry.parentId)!
          : input.parentId;
        const baseName =
          options?.copy && !entry.parentId
            ? `${entry.name.slice(0, 197)} 副本`
            : entry.name;
        const name = await uniqueName(tx, spaceId, parentId, baseName);
        const created = await createFile(tx, userId, spaceId, {
          kind: entry.kind,
          name,
          parentId,
        });
        const newId = ids.get(entry.id)!;
        await tx
          .update(files)
          .set({
            id: newId,
            createdAt: options?.copy ? new Date() : new Date(entry.createdAt),
            updatedAt: options?.copy ? new Date() : new Date(entry.updatedAt),
          })
          .where(eq(files.id, created.id));
        imported.push(newId);
      }
      await insertAssets(tx);
      for (const entry of manifest.entries) {
        signal.throwIfAborted();
        if (entry.kind === "folder") continue;
        const fileId = ids.get(entry.id)!;
        let projection: Record<string, unknown>,
          documentState: Buffer | null = null,
          engineState: Record<string, unknown> | undefined;
        if (entry.kind === "doc") {
          const doc = createDocumentState(await rewritten(entry));
          projection = documentProjection(doc);
          documentState = Buffer.from(Y.encodeStateAsUpdate(doc));
          doc.destroy();
        } else if (entry.kind === "sheet") {
          ({ projection, engineState } = await preparedContent(
            prepared,
            entry.id,
          ));
        } else {
          const asset = manifest.assets.find(
            (asset) => asset.id === entry.assetId,
          )!;
          projection = {
            assetId: assetIds.get(asset.id)!,
            name: asset.filename,
            size: asset.size,
            ...(entry.kind === "slide"
              ? { slides: prepared.slides.get(asset.id) }
              : { mime: asset.mime }),
          };
        }
        const engine =
          entry.kind === "doc"
            ? "yjs"
            : entry.kind === "sheet"
              ? "fortune"
              : entry.kind === "slide"
                ? "pptx"
                : "asset";
        await tx
          .insert(fileContents)
          .values({ fileId, engine, projection, documentState, engineState });
        const [version] = await tx
          .insert(fileVersions)
          .values({
            fileId,
            revision: 1,
            epoch: 1,
            source: "initial",
            actorId: userId,
            projection,
            documentState,
            engineState,
          })
          .returning({ id: fileVersions.id });
        await syncContentAssets(tx, fileId, projection, undefined, userId);
        await syncContentAssets(tx, fileId, projection, version!.id, userId);
      }
      await writeReceipt(tx, imported);
      return imported;
    });
  } catch (error) {
    // 提交已成功但后续通知失败时，幂等结果优先，不能误删已引用的附件。
    const receipt = await importReceipt(services, userId, batchId);
    if (
      receipt &&
      (!options?.fingerprint ||
        receipt.requestFingerprint === options.fingerprint)
    )
      return receipt.fileIds;
    throw error;
  } finally {
    // 同批次的竞争请求可能已有赢家，只清理本次未提交的随机存储键。
    const newIds = [...assetIds.values()];
    const persisted = newIds.length
      ? await services.database.db
          .select({ id: assets.id })
          .from(assets)
          .where(inArray(assets.id, newIds))
      : [];
    const retained = new Set(persisted.map((asset) => asset.id));
    await Promise.allSettled(
      [...staged]
        .filter(([id]) => !retained.has(assetIds.get(id)!))
        .map(([, asset]) => unlink(asset.path)),
    );
  }
}
