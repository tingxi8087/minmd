import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../../../../../system/server/src/database/client";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import { AppError } from "../../../../../system/server/src/errors";
import { files, fileFavorites, fileVisits } from "../../database/schema/files";
import { requireSpaceAccess } from "../spaces/service";
/** 登录不是文件授权；每次调用都重新检查空间成员资格和软删除状态。 */
export async function requireFileAccess(
  database: Database | Database["db"] | Transaction,
  userId: string,
  fileId: string,
  options: { deleted?: boolean } = {},
) {
  const db = "db" in database ? database.db : database;
  const [file] = await db.select().from(files).where(eq(files.id, fileId));
  if (!file) throw new AppError("NOT_FOUND", "文件不存在", 404);
  await requireSpaceAccess(db, userId, file.spaceId);
  if (file.deletedAt && !options.deleted)
    throw new AppError("FILE_DELETED", "文件已移入回收站", 409);
  return file;
}
export function fileResponse(
  file: typeof files.$inferSelect,
  favorite = false,
  accessedAt: Date | null = null,
) {
  return {
    ...file,
    favorite,
    accessedAt: accessedAt?.toISOString() ?? null,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
    deletedAt: file.deletedAt?.toISOString() ?? null,
  };
}

export async function fileResponses(
  db: Database["db"] | Transaction,
  userId: string,
  rows: (typeof files.$inferSelect)[],
) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const favorites = await db
    .select()
    .from(fileFavorites)
    .where(
      and(eq(fileFavorites.userId, userId), inArray(fileFavorites.fileId, ids)),
    );
  const visits = await db
    .select()
    .from(fileVisits)
    .where(and(eq(fileVisits.userId, userId), inArray(fileVisits.fileId, ids)));
  const favoriteIds = new Set(favorites.map((row) => row.fileId));
  const dates = new Map(visits.map((row) => [row.fileId, row.visitedAt]));
  return rows.map((row) =>
    fileResponse(row, favoriteIds.has(row.id), dates.get(row.id) ?? null),
  );
}
