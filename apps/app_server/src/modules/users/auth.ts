import type { FastifyInstance } from "fastify";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import type { Database } from "../../../../../system/server/src/database/client";
import type { AppConfig } from "../../../../../system/server/src/config/env";
import { AppError } from "../../../../../system/server/src/errors";
import { hashToken } from "../../../../../system/server/src/modules/auth/password";
import { csrfFor } from "../../../../../system/server/src/modules/auth/plugin";
import {
  codesFor,
  type PermissionCatalog,
} from "../../../../../system/server/src/modules/permissions/registry";
import {
  roles,
  rolePermissions,
} from "../../../../../system/server/src/database/schema/system";
import {
  appUsers,
  appUserRoles,
  appUserSessions,
} from "../../database/schema/users";
export const appSessionCookie = "mas_app_session";
export interface AppIdentity {
  id: string;
  sessionId: string;
  permissions: string[];
  csrfToken: string;
}
declare module "fastify" {
  interface FastifyRequest {
    appIdentity: AppIdentity | null;
  }
}
/** 身份与后台完全隔离；角色权限每次请求重新读取。 */
export async function installAppAuthentication(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
  catalog: PermissionCatalog,
) {
  app.decorateRequest("appIdentity", null);
  app.addHook("onReady", async () => {
    await database.db
      .update(appUserSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          ne(appUserSessions.transport, config.AUTH_TRANSPORT),
          isNull(appUserSessions.revokedAt),
        ),
      );
  });
  app.addHook("onRequest", async (request, reply) => {
    const access = request.routeOptions.config;
    if (!access.auth || access.authScope !== "app") return;
    reply.header("cache-control", "no-store");
    const token =
      config.AUTH_TRANSPORT === "bearer"
        ? /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(
            request.headers.authorization ?? "",
          )?.[1]
        : request.cookies[appSessionCookie];
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new AppError("UNAUTHENTICATED", "请先登录前台账号", 401);
    const [row] = await database.db
      .select({ user: appUsers, session: appUserSessions })
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
    if (!row) throw new AppError("SESSION_EXPIRED", "前台登录已失效", 401);
    const assigned = await database.db
      .select({ code: rolePermissions.permissionCode })
      .from(appUserRoles)
      .innerJoin(
        roles,
        and(eq(roles.id, appUserRoles.roleId), eq(roles.scope, "app")),
      )
      .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .where(eq(appUserRoles.userId, row.user.id));
    request.appIdentity = {
      id: row.user.id,
      sessionId: row.session.id,
      csrfToken: csrfFor(row.session.tokenHash),
      permissions: [...new Set(assigned.map((p) => p.code))].filter((code) =>
        codesFor(catalog, "app").includes(code),
      ),
    };
    if (
      config.AUTH_TRANSPORT === "cookie" &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method)
    ) {
      const supplied = request.headers["x-csrf-token"];
      if (
        request.headers.origin !== config.PUBLIC_ORIGIN ||
        typeof supplied !== "string" ||
        !/^[a-f0-9]{64}$/.test(supplied) ||
        !timingSafeEqual(
          Buffer.from(supplied),
          Buffer.from(request.appIdentity.csrfToken),
        )
      )
        throw new AppError("CSRF_INVALID", "请求来源或 CSRF 凭证无效", 403);
    }
    if (
      access.superAdmin ||
      access.permissions?.some(
        (code) => !request.appIdentity!.permissions.includes(code),
      )
    )
      throw new AppError("PERMISSION_DENIED", "没有访问权限", 403);
  });
}
