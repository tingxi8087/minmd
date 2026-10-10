import type { FastifyInstance } from "fastify";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Database } from "../../database/client";
import type { AppConfig } from "../../config/env";
import {
  roles,
  admins,
  adminRoles,
  rolePermissions,
  sessions,
} from "../../database/schema/system";
import { codesFor, type PermissionCatalog } from "../permissions/registry";
import { AppError } from "../../errors";
import { hashToken } from "./password";
import { writeAudit } from "../audit/service";
export interface Identity {
  id: string;
  account: string;
  displayName: string;
  isSuperAdmin: boolean;
  permissions: string[];
  sessionId: string;
  csrfToken: string;
}
declare module "fastify" {
  interface FastifyRequest {
    identity: Identity | null;
  }
  interface FastifyContextConfig {
    superAdmin?: boolean;
  }
}
export const sessionCookie = "mas_session";
export const csrfFor = (tokenHash: string) =>
  createHmac("sha256", tokenHash).update("mas-csrf-v1").digest("hex");
export async function installAuthentication(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
  catalog: PermissionCatalog,
) {
  const permissionCodes = codesFor(catalog, "admin");
  app.decorateRequest("identity", null);
  app.addHook("onReady", async () => {
    // A deployment has one transport. Revoke the other transport on every startup,
    // so switching back cannot revive sessions issued before the first switch.
    await database.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          ne(sessions.transport, config.AUTH_TRANSPORT),
          isNull(sessions.revokedAt),
        ),
      );
  });
  app.addHook("onRoute", (route) => {
    if (!route.url.startsWith("/api/")) return;
    const access = route.config;
    if ((access?.permissions?.length || access?.superAdmin) && !access.auth)
      throw new Error(`Protected rules require auth: ${route.url}`);
    if (
      access?.permissions?.some(
        (code) =>
          !codesFor(catalog, access.authScope ?? "admin").includes(code),
      )
    )
      throw new Error(`Unknown route permission: ${route.url}`);
  });
  app.addHook("onRequest", async (request, reply) => {
    if (
      !request.routeOptions.config.auth ||
      request.routeOptions.config.authScope === "app"
    )
      return;
    reply.header("cache-control", "no-store");
    const token =
      config.AUTH_TRANSPORT === "bearer"
        ? /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(
            request.headers.authorization ?? "",
          )?.[1]
        : request.cookies[sessionCookie];
    const deny = async (
      status: number,
      code: string,
      message: string,
    ): Promise<never> => {
      await writeAudit(database.db, request, config.APP_ENV, {
        action: code,
        targetType: "route",
        targetId: request.routeOptions.url,
        result: "denied",
      });
      throw new AppError(code, message, status);
    };
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      return deny(401, "UNAUTHENTICATED", "请先登录");
    const [row] = await database.db
      .select({ admin: admins, session: sessions })
      .from(sessions)
      .innerJoin(admins, eq(admins.id, sessions.adminId))
      .where(
        and(
          eq(sessions.tokenHash, hashToken(token)),
          eq(sessions.transport, config.AUTH_TRANSPORT),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          eq(admins.status, "enabled"),
        ),
      );
    if (!row) return deny(401, "SESSION_EXPIRED", "登录已失效，请重新登录");
    const assigned = await database.db
      .select({ code: rolePermissions.permissionCode })
      .from(adminRoles)
      .innerJoin(
        roles,
        and(eq(roles.id, adminRoles.roleId), eq(roles.scope, "admin")),
      )
      .innerJoin(rolePermissions, eq(adminRoles.roleId, rolePermissions.roleId))
      .where(eq(adminRoles.adminId, row.admin.id));
    request.identity = {
      id: row.admin.id,
      account: row.admin.account,
      displayName: row.admin.isSuperAdmin
        ? "超级管理员"
        : row.admin.displayName,
      isSuperAdmin: row.admin.isSuperAdmin,
      permissions: row.admin.isSuperAdmin
        ? [...permissionCodes]
        : [...new Set(assigned.map((p) => p.code))].filter((code) =>
            (permissionCodes as string[]).includes(code),
          ),
      sessionId: row.session.id,
      csrfToken: csrfFor(row.session.tokenHash),
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
        supplied.length !== request.identity.csrfToken.length ||
        !timingSafeEqual(
          Buffer.from(supplied),
          Buffer.from(request.identity.csrfToken),
        )
      )
        return deny(403, "CSRF_INVALID", "请求来源或 CSRF 凭证无效");
    }
    const access = request.routeOptions.config;
    if (access.superAdmin && !request.identity.isSuperAdmin)
      return deny(403, "SUPER_ADMIN_REQUIRED", "仅超级管理员可以访问");
    if (
      !request.identity.isSuperAdmin &&
      access.permissions?.some(
        (code) => !request.identity!.permissions.includes(code),
      )
    )
      return deny(403, "PERMISSION_DENIED", "没有访问权限");
  });
}
