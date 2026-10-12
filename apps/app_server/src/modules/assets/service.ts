import { and, eq, inArray, lt, notExists, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { mkdir, rename, unlink } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import type { Database } from "../../../../../system/server/src/database/client";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import { AppError } from "../../../../../system/server/src/errors";
import {
  assets,
  fileAssets,
  versionAssets,
} from "../../database/schema/assets";
import { fileVersions } from "../../database/schema/contents";
import { files } from "../../database/schema/files";
import { requireFileAccess } from "../files/service";
import { requireSpaceAccess } from "../spaces/service";
import { validateAsset } from "./validate";

export async function storeAsset(
  database: Database,
  directory: string,
  userId: string,
  spaceId: string,
  filename: string,
  suppliedMime: string,
  bytes: Buffer,
  hooks: {
    fileId?: string;
    authorize?: (tx: Transaction) => Promise<void>;
    onCommitted?: (
      tx: Transaction,
      result: {
        id: string;
        filename: string;
        mime: string;
        size: number;
        slides: number;
        url: string;
      },
    ) => Promise<void>;
  } = {},
) {
  const authorizeTarget = async (db: Database | Transaction) => {
    if (hooks.fileId) {
      const file = await requireFileAccess(db, userId, hooks.fileId, {
        permission: "edit",
      });
      if (file.spaceId !== spaceId)
        throw new AppError("ASSET_SPACE_MISMATCH", "附件目标空间不匹配", 403);
    } else await requireSpaceAccess(db, userId, spaceId);
  };
  await authorizeTarget(database);
  const parsed = await validateAsset(bytes, filename, suppliedMime);
  const storageKey = crypto.randomUUID();
  await mkdir(directory, { recursive: true });
  const path = join(resolve(directory), storageKey);
  try {
    await Bun.write(`${path}.tmp`, bytes);
    await rename(`${path}.tmp`, path);
    const row = await database.db.transaction(async (tx) => {
      await authorizeTarget(tx);
      await hooks.authorize?.(tx);
      const [row] = await tx
        .insert(assets)
        .values({
          spaceId,
          uploadedForFileId: hooks.fileId ?? null,
          storageKey,
          filename: basename(filename).slice(0, 200) || "附件",
          mime: parsed.mime,
          size: bytes.length,
          checksum: createHash("sha256").update(bytes).digest("hex"),
          uploadedBy: userId,
        })
        .returning();
      const result = {
        id: row!.id,
        filename: row!.filename,
        mime: row!.mime,
        size: row!.size,
        slides: parsed.slides,
        url: `/api/app/assets/${row!.id}`,
      };

      await hooks.onCommitted?.(tx, result);
      return result;
    });
    return row;
  } catch (error) {
    await Promise.allSettled([unlink(path), unlink(`${path}.tmp`)]);
    throw error;
  }
}
/** 外部协作者只读取获授权文件的附件；临时上传允许目标文件编辑者预览，匿名分享仍仅开放正文引用。 */
export async function requireAssetAccess(
  database: Database | Database["db"] | Transaction,
  userId: string,
  asset: typeof assets.$inferSelect,
) {
  const db = "db" in database ? database.db : database;
  try {
    await requireSpaceAccess(db, userId, asset.spaceId);
    return;
  } catch (error) {
    if (!(error instanceof AppError) || error.statusCode !== 403) throw error;
  }
  const allowed = async (fileId: string, permission: "read" | "edit") => {
    try {
      await requireFileAccess(db, userId, fileId, { permission });
      return true;
    } catch (error) {
      if (
        !(error instanceof AppError) ||
        ![403, 404, 409].includes(error.statusCode ?? 500)
      )
        throw error;
      return false;
    }
  };
  if (
    asset.uploadedForFileId &&
    (await allowed(
      asset.uploadedForFileId,
      asset.uploadedBy === userId ? "read" : "edit",
    ))
  )
    return;
  const current = await db
    .select({ fileId: fileAssets.fileId })
    .from(fileAssets)
    .where(eq(fileAssets.assetId, asset.id));
  for (const reference of current)
    if (await allowed(reference.fileId, "read")) return;
  const history = await db
    .select({ fileId: fileVersions.fileId })
    .from(versionAssets)
    .innerJoin(fileVersions, eq(fileVersions.id, versionAssets.versionId))
    .where(eq(versionAssets.assetId, asset.id));
  for (const reference of history)
    if (await allowed(reference.fileId, "edit")) return;
  throw new AppError("ASSET_FORBIDDEN", "没有附件访问权限", 403);
}
/** 当前及版本引用分别记录，不能因正文删图清掉历史原文件。 */
export async function syncContentAssets(
  tx: Transaction,
  fileId: string,
  projection: Record<string, unknown>,
  versionId?: string,
  actorId?: string,
) {
  const ids = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 64) throw new AppError("CONTENT_INVALID", "内容结构过深", 400);
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    const item = value as Record<string, unknown>;
    if (typeof item.assetId === "string") {
      if (!/^[0-9a-f-]{36}$/i.test(item.assetId))
        throw new AppError("ASSET_INVALID", "附件标识无效", 400);
      ids.add(item.assetId);
    }
    Object.values(item).forEach((child) => visit(child, depth + 1));
  };
  visit(projection, 0);
  const [file] = await tx
    .select({ spaceId: files.spaceId })
    .from(files)
    .where(eq(files.id, fileId));
  if (!file) throw new AppError("NOT_FOUND", "文件不存在", 404);
  const rows = ids.size
    ? await tx
        .select()
        .from(assets)
        .where(
          and(eq(assets.spaceId, file.spaceId), inArray(assets.id, [...ids])),
        )
        .for("share")
    : [];
  if (rows.length !== ids.size)
    throw new AppError("ASSET_FORBIDDEN", "附件不存在或属于其他空间", 403);
  if (actorId)
    for (const asset of rows) await requireAssetAccess(tx, actorId, asset);
  if (versionId) {
    if (ids.size)
      await tx
        .insert(versionAssets)
        .values([...ids].map((assetId) => ({ versionId, assetId })))
        .onConflictDoNothing();
  } else {
    await tx.delete(fileAssets).where(eq(fileAssets.fileId, fileId));
    if (ids.size)
      await tx
        .insert(fileAssets)
        .values([...ids].map((assetId) => ({ fileId, assetId })))
        .onConflictDoNothing();
  }
}
/** 删除 DB 行后才删原文件，失败可再次清理；引用外键防止清理与绑定竞态。 */
export async function cleanUnboundAssets(
  database: Database,
  directory: string,
  graceHours: number,
) {
  const rows = await database.db
    .select()
    .from(assets)
    .where(
      and(
        lt(assets.createdAt, new Date(Date.now() - graceHours * 3600000)),
        notExists(
          database.db
            .select({ id: fileAssets.assetId })
            .from(fileAssets)
            .where(eq(fileAssets.assetId, assets.id)),
        ),
        notExists(
          database.db
            .select({ id: versionAssets.assetId })
            .from(versionAssets)
            .where(eq(versionAssets.assetId, assets.id)),
        ),
      ),
    );
  for (const row of rows) {
    try {
      await database.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${row.id}, 91732))`,
        );
        const deleted = await tx
          .delete(assets)
          .where(
            and(
              eq(assets.id, row.id),
              notExists(
                tx
                  .select({ id: fileAssets.assetId })
                  .from(fileAssets)
                  .where(eq(fileAssets.assetId, row.id)),
              ),
              notExists(
                tx
                  .select({ id: versionAssets.assetId })
                  .from(versionAssets)
                  .where(eq(versionAssets.assetId, row.id)),
              ),
            ),
          )
          .returning({ id: assets.id });
        if (deleted.length)
          await unlink(join(resolve(directory), row.storageKey)).catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code !== "ENOENT") throw error;
            },
          );
      });
    } catch {
      /* 原文件删除失败回滚元数据，下一轮清理继续重试。 */
    }
  }
}
