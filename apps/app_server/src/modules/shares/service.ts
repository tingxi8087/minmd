import { and, eq, gt, isNull } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../../../../../system/server/src/config/env";
import { appUsers, appUserSessions } from "../../database/schema/users";
import { appSessionCookie } from "../users/auth";
import type { Database } from "../../../../../system/server/src/database/client";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import { AppError } from "../../../../../system/server/src/errors";
import { hashToken } from "../../../../../system/server/src/modules/auth/password";
import { resolveFileAccess } from "../file-access/service";
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
    audience: share?.audience ?? "anyone",
    permission: share?.permission ?? "read",
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
  viewerId?: string,
  allowIndependentAccess = true,
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
  if (row.share.audience === "authenticated" && !viewerId)
    throw new AppError("SHARE_LOGIN_REQUIRED", "此分享需要登录后访问", 401);
  if (passwordRequired && row.share.passwordHash) {
    // 空间成员及指定协作者依靠独立授权访问，不受公开链接密码影响。
    if (
      allowIndependentAccess &&
      viewerId &&
      (await resolveFileAccess(db, viewerId, row.file)).permission
    )
      return row;
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

/** 访客入口只识别前台身份，不能回退后台 Cookie 或令牌。 */
export async function publicShareUser(
  db: ShareDatabase,
  config: AppConfig,
  request: FastifyRequest,
) {
  if (request.appIdentity) return request.appIdentity.id;
  const token =
    config.AUTH_TRANSPORT === "cookie"
      ? request.cookies[appSessionCookie]
      : /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(
          request.headers.authorization ?? "",
        )?.[1];
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  const [session] = await db
    .select({ userId: appUserSessions.userId })
    .from(appUserSessions)
    .innerJoin(appUsers, eq(appUsers.id, appUserSessions.userId))
    .where(
      and(
        eq(appUserSessions.tokenHash, hashToken(token)),
        eq(appUserSessions.transport, config.AUTH_TRANSPORT),
        isNull(appUserSessions.revokedAt),
        gt(appUserSessions.expiresAt, new Date()),
        eq(appUsers.status, "enabled"),
      ),
    );
  return session?.userId;
}
