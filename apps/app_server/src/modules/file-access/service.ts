import { and, eq, gt, isNull, inArray } from "drizzle-orm";
import type { Database } from "../../../../../system/server/src/database/client";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import { AppError } from "../../../../../system/server/src/errors";
import { files } from "../../database/schema/files";
import { spaces, spaceMembers } from "../../database/schema/spaces";
import { appUsers } from "../../database/schema/users";
import { fileShares } from "../../database/schema/shares";
import {
  fileAccessGrants,
  shareUserSessions,
} from "../../database/schema/file-access";
import {
  resolvePermission,
  permissionRank,
  type FilePermission,
} from "./policy";
export type AccessDatabase = Database["db"] | Transaction;
/** 批量读取文件权限，避免文件树为每行重复查询；同一规则也用于正文和协作鉴权。 */
export async function resolveFileAccessBatch(
  db: AccessDatabase,
  userId: string,
  rows: (typeof files.$inferSelect)[],
) {
  const result = new Map<
    string,
    { permission: FilePermission | null; member: boolean }
  >();
  if (!rows.length) return result;
  const [user] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(eq(appUsers.id, userId), eq(appUsers.status, "enabled")));
  if (!user) throw new AppError("UNAUTHENTICATED", "账号不可用", 401);
  const fileIds = rows.map((file) => file.id);
  const spaceIds = [...new Set(rows.map((file) => file.spaceId))];
  const owners = await db
    .select({ id: spaces.id, ownerId: spaces.ownerId })
    .from(spaces)
    .where(inArray(spaces.id, spaceIds));
  const members = await db
    .select({ spaceId: spaceMembers.spaceId })
    .from(spaceMembers)
    .where(
      and(
        inArray(spaceMembers.spaceId, spaceIds),
        eq(spaceMembers.userId, userId),
      ),
    );
  const grants = await db
    .select()
    .from(fileAccessGrants)
    .where(
      and(
        inArray(fileAccessGrants.fileId, fileIds),
        eq(fileAccessGrants.userId, userId),
      ),
    );
  const shares = await db
    .select()
    .from(fileShares)
    .where(
      and(inArray(fileShares.fileId, fileIds), isNull(fileShares.revokedAt)),
    );
  const shareIds = shares.map((share) => share.id);
  const accepted = shareIds.length
    ? await db
        .select()
        .from(shareUserSessions)
        .where(
          and(
            inArray(shareUserSessions.shareId, shareIds),
            eq(shareUserSessions.userId, userId),
            gt(shareUserSessions.expiresAt, new Date()),
          ),
        )
    : [];
  const memberSpaces = new Set(members.map((member) => member.spaceId));
  const ownerBySpace = new Map(
    owners.map((space) => [space.id, space.ownerId]),
  );
  const grantByFile = new Map(
    grants.map((grant) => [grant.fileId, grant.permission]),
  );
  const shareByFile = new Map(shares.map((share) => [share.fileId, share]));
  const acceptedByShare = new Map(
    accepted.map((session) => [session.shareId, session.generation]),
  );
  const now = Date.now();
  for (const file of rows) {
    const member = memberSpaces.has(file.spaceId);
    const share = shareByFile.get(file.id);
    const publicPermission =
      file.visibility === "public" &&
      !file.deletedAt &&
      file.kind !== "folder" &&
      share &&
      (!share.expiresAt || share.expiresAt.getTime() > now) &&
      (!share.passwordHash ||
        acceptedByShare.get(share.id) === share.generation)
        ? share.permission
        : undefined;
    result.set(file.id, {
      permission: resolvePermission({
        manager:
          member &&
          (file.createdBy === userId ||
            ownerBySpace.get(file.spaceId) === userId),
        member,
        memberPermission: file.memberPermission,
        grant: grantByFile.get(file.id),
        publicPermission,
      }),
      member,
    });
  }
  return result;
}
/** 身份、成员关系、单文件授权和公开状态逐次读取，不能靠前端或旧票据授权。 */
export async function resolveFileAccess(
  db: AccessDatabase,
  userId: string,
  file: typeof files.$inferSelect,
) {
  return (await resolveFileAccessBatch(db, userId, [file])).get(file.id)!;
}
export function assertFilePermission(
  actual: FilePermission | null,
  required: FilePermission,
) {
  if (permissionRank(actual) < permissionRank(required))
    throw new AppError(
      actual ? "FILE_PERMISSION_DENIED" : "FILE_ACCESS_REQUIRED",
      actual ? "当前文件权限不足" : "没有文档访问权限，可以申请访问",
      403,
    );
}
