import { and, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "../../../../../system/server/src/database/client";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import { AppError } from "../../../../../system/server/src/errors";
import { hashToken } from "../../../../../system/server/src/modules/auth/password";
import { files } from "../../database/schema/files";
import { fileShares, shareGuestSessions } from "../../database/schema/shares";
export type ShareDatabase = Database["db"] | Transaction;
export function shareCookie(shareId: string) {
  return `minmd_guest_${shareId.replace(/-/g, "")}`;
}
export function shareStatus(
  file: typeof files.$inferSelect,
  share?: typeof fileShares.$inferSelect,
) {
  return {
    visibility: file.visibility,
    enabled:
      file.visibility === "public" &&
      !!share &&
      !share.revokedAt &&
      (!share.expiresAt || share.expiresAt.getTime() > Date.now()),
    hasPassword: !!share?.passwordHash,
    expiresAt: share?.expiresAt?.toISOString() ?? null,
    generation: share?.generation ?? 0,
  };
}
/** 公开不授予空间资格；每次请求重新校验Token、状态与分享世代。 */
export async function requirePublicShare(
  db: ShareDatabase,
  token: string,
  cookies: Record<string, string | undefined>,
  passwordRequired = true,
) {
  const [row] = await db
    .select({ share: fileShares, file: files })
    .from(fileShares)
    .innerJoin(files, eq(files.id, fileShares.fileId))
    .where(
      and(
        eq(fileShares.tokenHash, hashToken(token)),
        eq(files.visibility, "public"),
        isNull(files.deletedAt),
        isNull(fileShares.revokedAt),
      ),
    );
  if (
    !row ||
    row.file.kind === "folder" ||
    (row.share.expiresAt && row.share.expiresAt.getTime() <= Date.now())
  )
    throw new AppError("SHARE_UNAVAILABLE", "分享不存在、已撤销或已过期", 404);
  if (passwordRequired && row.share.passwordHash) {
    const guestToken = cookies[shareCookie(row.share.id)];
    if (!guestToken || !/^[A-Za-z0-9_-]{43}$/.test(guestToken))
      throw new AppError("SHARE_PASSWORD_REQUIRED", "请输入分享密码", 403);
    const [session] = await db
      .select({ id: shareGuestSessions.id })
      .from(shareGuestSessions)
      .where(
        and(
          eq(shareGuestSessions.tokenHash, hashToken(guestToken)),
          eq(shareGuestSessions.shareId, row.share.id),
          eq(shareGuestSessions.generation, row.share.generation),
          gt(shareGuestSessions.expiresAt, new Date()),
        ),
      );
    if (!session)
      throw new AppError(
        "SHARE_PASSWORD_REQUIRED",
        "分享密码授权已失效，请重新验证",
        403,
      );
  }
  return row;
}
