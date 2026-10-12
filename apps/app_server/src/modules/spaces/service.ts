import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../../../../system/server/src/database/client";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import { AppError } from "../../../../../system/server/src/errors";
import { spaces, spaceMembers } from "../../database/schema/spaces";
import { appUsers } from "../../database/schema/users";
export type SpaceDatabase = Database["db"] | Transaction;
/** 所有树、成员和负责人变更共用此锁，避免授权检查后资源归属发生竞争。 */
export async function lockSpace(tx: Transaction, spaceId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${spaceId}, 91731))`,
  );
}
export async function requireSpaceAccess(
  database: Database | SpaceDatabase,
  userId: string,
  spaceId: string,
) {
  const db = "db" in database ? database.db : database;
  const [space] = await db
    .select({ space: spaces })
    .from(spaces)
    .innerJoin(
      spaceMembers,
      and(eq(spaceMembers.spaceId, spaces.id), eq(spaceMembers.userId, userId)),
    )
    .innerJoin(
      appUsers,
      and(eq(appUsers.id, spaceMembers.userId), eq(appUsers.status, "enabled")),
    )
    .where(eq(spaces.id, spaceId));
  if (!space)
    throw new AppError("SPACE_FORBIDDEN", "空间不存在或无权访问", 403);
  return space.space;
}
export async function requireSpaceOwner(
  db: SpaceDatabase,
  userId: string,
  spaceId: string,
) {
  const space = await requireSpaceAccess(db, userId, spaceId);
  if (space.ownerId !== userId)
    throw new AppError("SPACE_OWNER_REQUIRED", "只有空间负责人可以操作", 403);
  return space;
}
export function spaceResponse(space: typeof spaces.$inferSelect) {
  return {
    ...space,
    createdAt: space.createdAt.toISOString(),
    updatedAt: space.updatedAt.toISOString(),
  };
}
