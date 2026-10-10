import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { eq } from "drizzle-orm";
import { AppError } from "../../errors";
import type { AppConfig } from "../../config/env";
import type { Database } from "../../database/client";
import { admins, sessions, auditLogs } from "../../database/schema/system";
import { hashPassword, hashToken, newToken } from "./password";
import { csrfFor, sessionCookie } from "./plugin";
import { writeAudit } from "../audit/service";
const identitySchema = Type.Object({
  id: Type.String({
    description: "记录 ID；操作已有记录时请替换为实际 ID",
    example: "00000000-0000-4000-8000-000000000001",
  }),
  account: Type.String({
    description: "后台用户登录账号",
    example: "demo_admin",
  }),
  displayName: Type.String({
    description: "后台用户显示名称",
    example: "演示管理员",
  }),
  isSuperAdmin: Type.Boolean({ description: "是否超级管理员", example: false }),
  permissions: Type.Array(Type.String(), {
    description: "权限标识列表",
    example: ["user:read"],
  }),
});
export async function registerAuthRoutes(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
) {
  const dummyHash = await hashPassword(newToken());
  app.get(
    "/api/auth/config",
    {
      config: { auth: false },
      schema: {
        tags: ["认证"],
        summary: "获取认证配置",
        description:
          "返回当前部署的认证传递方式、浏览器令牌存储策略和环境。此接口无需登录。",
        response: {
          200: Type.Object({
            transport: Type.String({
              description: "认证传递方式：bearer 或 cookie",
              example: "bearer",
            }),
            tokenStorage: Type.Union([Type.String(), Type.Null()], {
              description: "浏览器令牌存储策略；Cookie 模式为 null",
              example: "sessionStorage",
            }),
            environment: Type.String({
              description: "服务端部署环境：development / staging / production",
              example: "development",
            }),
          }),
        },
      },
    },
    async (_, reply) => {
      reply.header("cache-control", "no-store");
      return {
        transport: config.AUTH_TRANSPORT,
        tokenStorage:
          config.AUTH_TRANSPORT === "bearer" ? config.AUTH_TOKEN_STORAGE : null,
        environment: config.APP_ENV,
      };
    },
  );
  app.post<{ Body: { account: string; password: string } }>(
    "/api/auth/login",
    {
      config: { auth: false, rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["认证"],
        summary: "登录",
        description:
          "校验后台用户账号密码并创建会话。Bearer 模式返回 token；Cookie 模式设置会话 Cookie 并返回 CSRF 令牌。失败次数受限流控制。",
        body: Type.Object(
          {
            account: Type.String({
              minLength: 3,
              maxLength: 64,
              description: "后台用户登录账号",
              example: "demo_admin",
            }),
            password: Type.String({
              minLength: 1,
              maxLength: 128,
              description: "登录密码，请手动填写",
            }),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            token: Type.Optional(
              Type.String({
                description: "Bearer 登录令牌，仅 bearer 模式返回，请妥善保管",
              }),
            ),
            csrfToken: Type.Optional(
              Type.String({
                description:
                  "Cookie 模式的 CSRF 令牌，写请求需通过 X-CSRF-Token 传递",
              }),
            ),
            expiresAt: Type.String({
              description: "会话到期时间（ISO 8601）",
              example: "2026-09-20T00:00:00.000Z",
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (
        config.AUTH_TRANSPORT === "cookie" &&
        request.headers.origin !== config.PUBLIC_ORIGIN
      )
        throw new AppError("CSRF_INVALID", "请求来源无效", 403);
      const account = request.body.account.trim().toLowerCase();
      const [candidate] = await database.db
        .select()
        .from(admins)
        .where(eq(admins.account, account));
      const valid = await Bun.password.verify(
        request.body.password,
        candidate?.passwordHash ?? dummyHash,
      );
      if (!candidate || !valid || candidate.status !== "enabled") {
        await database.db.insert(auditLogs).values({
          action: "auth.login",
          targetType: "admin",
          result: "denied",
          environment: config.APP_ENV,
          requestId: request.id,
        });
        throw new AppError("LOGIN_FAILED", "账号或密码错误", 401);
      }
      const token = newToken();
      const expiresAt = new Date(
        Date.now() + config.AUTH_SESSION_HOURS * 3600000,
      );
      await database.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(admins)
          .where(eq(admins.id, candidate.id))
          .for("update");
        if (
          !current ||
          current.status !== "enabled" ||
          current.passwordHash !== candidate.passwordHash
        )
          throw new AppError("LOGIN_FAILED", "账号或密码错误", 401);
        await tx.insert(sessions).values({
          adminId: candidate.id,
          tokenHash: hashToken(token),
          transport: config.AUTH_TRANSPORT,
          expiresAt,
        });
        await tx
          .update(admins)
          .set({ lastLoginAt: new Date() })
          .where(eq(admins.id, candidate.id));
        await tx.insert(auditLogs).values({
          actorId: candidate.id,
          actorAccount: candidate.account,
          action: "auth.login",
          targetType: "admin",
          targetId: candidate.id,
          result: "success",
          environment: config.APP_ENV,
          requestId: request.id,
        });
      });
      if (config.AUTH_TRANSPORT === "cookie") {
        reply.setCookie(sessionCookie, token, {
          httpOnly: true,
          secure: config.APP_ENV === "production",
          sameSite: "strict",
          path: "/api",
          expires: expiresAt,
        });
        return {
          csrfToken: csrfFor(hashToken(token)),
          expiresAt: expiresAt.toISOString(),
        };
      }
      return { token, expiresAt: expiresAt.toISOString() };
    },
  );
  app.get(
    "/api/auth/me",
    {
      config: { auth: true },
      schema: {
        tags: ["认证"],
        summary: "当前用户",
        description:
          "返回当前会话的用户身份与实时权限；Cookie 模式同时返回写请求所需的 CSRF 令牌。",
        response: {
          200: Type.Object({
            admin: { ...identitySchema, description: "当前登录的后台用户身份" },
            csrfToken: Type.Optional(
              Type.String({
                description:
                  "Cookie 模式的 CSRF 令牌，写请求需通过 X-CSRF-Token 传递",
              }),
            ),
          }),
        },
      },
    },
    async (request) => ({
      admin: request.identity!,
      ...(config.AUTH_TRANSPORT === "cookie"
        ? { csrfToken: request.identity!.csrfToken }
        : {}),
    }),
  );
  app.post(
    "/api/auth/logout",
    {
      config: { auth: true },
      schema: {
        tags: ["认证"],
        summary: "退出登录",
        description:
          "撤销当前会话；Cookie 模式同时清理浏览器会话 Cookie。请求体传空对象。",
        body: Type.Object({}, { additionalProperties: false }),
        response: {
          200: Type.Object({
            ok: Type.Boolean({ description: "操作是否成功", example: true }),
          }),
        },
      },
    },
    async (request, reply) => {
      await database.db.transaction(async (tx) => {
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.id, request.identity!.sessionId));
        await writeAudit(tx, request, config.APP_ENV, {
          action: "auth.logout",
          targetType: "session",
          targetId: request.identity!.sessionId,
          result: "success",
        });
      });
      if (config.AUTH_TRANSPORT === "cookie")
        reply.clearCookie(sessionCookie, {
          path: "/api",
          httpOnly: true,
          secure: config.APP_ENV === "production",
          sameSite: "strict",
        });
      return { ok: true };
    },
  );
}
