import { and, eq, isNull, asc, desc, inArray, sql } from "drizzle-orm";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import { AppError } from "../../../../../system/server/src/errors";
import { files } from "../../database/schema/files";
import { lockSpace, requireSpaceAccess } from "../spaces/service";
import { requireFileAccess } from "./service";
import type { CreateBody, MoveBody, PatchBody, RestoreBody } from "./schemas";
type File = typeof files.$inferSelect;
/** 浏览器与外部AI共用目录事务约束；调用者负责事务及额外权限复验。 */
export const childrenOf = (rows: File[], rootId: string) => {
  const result = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows)
      if (row.parentId && result.has(row.parentId) && !result.has(row.id)) {
        result.add(row.id);
        grew = true;
      }
  }
  return result;
};
export const checkMetadataRevision = (file: File, expected: number) => {
  if (file.metadataRevision !== expected)
    throw new AppError(
      "METADATA_CONFLICT",
      "文件资料已被修改，请刷新后重试",
      409,
    );
};
const parentCondition = (parentId: string | null) =>
  parentId ? eq(files.parentId, parentId) : isNull(files.parentId);
export async function validateParent(
  tx: Transaction,
  spaceId: string,
  parentId: string | null,
  movingId?: string,
) {
  if (!parentId) return;
  const rows = await tx.select().from(files).where(eq(files.spaceId, spaceId));
  const parent = rows.find((row) => row.id === parentId);
  if (!parent || parent.deletedAt)
    throw new AppError(
      "INVALID_PARENT",
      "目标位置不存在、已删除或不在当前空间",
      409,
    );
  if (parent.kind !== "doc" && parent.kind !== "folder")
    throw new AppError("INVALID_PARENT", "只有文档和文件夹可以包含子文件", 400);
  if (movingId && childrenOf(rows, movingId).has(parentId))
    throw new AppError("TREE_CYCLE", "不能移动到自身或后代节点", 409);
}
async function lockedFile(
  tx: Transaction,
  userId: string,
  fileId: string,
  deleted = false,
) {
  const first = await requireFileAccess(tx, userId, fileId, { deleted });
  await lockSpace(tx, first.spaceId);
  return requireFileAccess(tx, userId, fileId, { deleted });
}
export async function createFile(
  tx: Transaction,
  userId: string,
  spaceId: string,
  body: CreateBody,
  onCreated?: (tx: Transaction, file: File) => Promise<void>,
) {
  await lockSpace(tx, spaceId);
  await requireSpaceAccess(tx, userId, spaceId);
  const parentId = body.parentId ?? null;
  await validateParent(tx, spaceId, parentId);
  const [last] = await tx
    .select({ position: files.position })
    .from(files)
    .where(
      and(
        eq(files.spaceId, spaceId),
        parentCondition(parentId),
        isNull(files.deletedAt),
      ),
    )
    .orderBy(desc(files.position))
    .limit(1);
  const [file] = await tx
    .insert(files)
    .values({
      spaceId,
      createdBy: userId,
      parentId,
      kind: body.kind,
      name: body.name.trim(),
      position: last ? last.position + 1 : 0,
    })
    .returning();
  await onCreated?.(tx, file!);
  return file!;
}
export async function renameFile(
  tx: Transaction,
  userId: string,
  fileId: string,
  body: PatchBody,
) {
  const file = await lockedFile(tx, userId, fileId);
  checkMetadataRevision(file, body.expectedMetadataRevision);
  const [updated] = await tx
    .update(files)
    .set({
      name: body.name.trim(),
      metadataRevision: file.metadataRevision + 1,
      updatedAt: new Date(),
    })
    .where(eq(files.id, file.id))
    .returning();
  return updated!;
}
export async function moveFile(
  tx: Transaction,
  userId: string,
  fileId: string,
  body: MoveBody,
) {
  const file = await lockedFile(tx, userId, fileId);
  checkMetadataRevision(file, body.expectedMetadataRevision);
  await validateParent(tx, file.spaceId, body.parentId, file.id);
  const siblings = await tx
    .select()
    .from(files)
    .where(
      and(
        eq(files.spaceId, file.spaceId),
        parentCondition(body.parentId),
        isNull(files.deletedAt),
      ),
    )
    .orderBy(asc(files.position), asc(files.createdAt), asc(files.id));
  const ordered = siblings.filter((row) => row.id !== file.id);
  const before = body.beforeId
    ? ordered.findIndex((row) => row.id === body.beforeId)
    : ordered.length;
  if (body.beforeId === file.id && file.parentId === body.parentId) return file;
  if (before < 0)
    throw new AppError(
      "INVALID_POSITION",
      "定位文件必须是目标目录内的有效同级文件",
      409,
    );
  ordered.splice(before, 0, file);
  for (const [position, row] of ordered.entries())
    if (row.position !== position || row.id === file.id)
      await tx
        .update(files)
        .set({
          position,
          ...(row.id === file.id ? { parentId: body.parentId } : {}),
          metadataRevision: sql`${files.metadataRevision}+1`,
          updatedAt: new Date(),
        })
        .where(eq(files.id, row.id));
  const [updated] = await tx.select().from(files).where(eq(files.id, file.id));
  return updated!;
}
export async function deleteFile(
  tx: Transaction,
  userId: string,
  fileId: string,
  expected?: number,
) {
  const file = await lockedFile(tx, userId, fileId);
  if (expected !== undefined) checkMetadataRevision(file, expected);
  const rows = await tx
    .select()
    .from(files)
    .where(eq(files.spaceId, file.spaceId));
  const subtree = childrenOf(rows, file.id);
  const ids = rows
    .filter((row) => subtree.has(row.id) && !row.deletedAt)
    .map((row) => row.id);
  await tx
    .update(files)
    .set({
      deletedAt: new Date(),
      deletedBatch: crypto.randomUUID(),
      metadataRevision: sql`${files.metadataRevision}+1`,
      updatedAt: new Date(),
    })
    .where(inArray(files.id, ids));
  return ids;
}
export async function restoreFile(
  tx: Transaction,
  userId: string,
  fileId: string,
  body: RestoreBody,
  expected?: number,
) {
  const file = await lockedFile(tx, userId, fileId, true);
  if (expected !== undefined) checkMetadataRevision(file, expected);
  if (!file.deletedAt || !file.deletedBatch)
    throw new AppError("FILE_NOT_DELETED", "文件不在回收站", 409);
  const rows = await tx
    .select()
    .from(files)
    .where(
      and(
        eq(files.spaceId, file.spaceId),
        eq(files.deletedBatch, file.deletedBatch),
      ),
    );
  const ids = rows.map((row) => row.id),
    set = new Set(ids);
  const roots = rows.filter((row) => !row.parentId || !set.has(row.parentId));
  for (const root of roots) {
    const parentId =
      body.parentId !== undefined ? body.parentId : root.parentId;
    await validateParent(tx, file.spaceId, parentId, root.id);
    await tx.update(files).set({ parentId }).where(eq(files.id, root.id));
  }
  await tx
    .update(files)
    .set({
      deletedAt: null,
      deletedBatch: null,
      metadataRevision: sql`${files.metadataRevision}+1`,
      updatedAt: new Date(),
    })
    .where(inArray(files.id, ids));
  const [updated] = await tx.select().from(files).where(eq(files.id, file.id));
  return updated!;
}
