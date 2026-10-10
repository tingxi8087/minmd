import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { eq } from "drizzle-orm";
import type { Database } from "../../../../../system/server/src/database/client";
import type { AppConfig } from "../../../../../system/server/src/config/env";
import type { PermissionCatalog } from "../../../../../system/server/src/modules/permissions/registry";
import { AppError } from "../../../../../system/server/src/errors";
import {
  hashPassword,
  hashToken,
  newToken,
} from "../../../../../system/server/src/modules/auth/password";
import { csrfFor } from "../../../../../system/server/src/modules/auth/plugin";
import { appUsers, appUserSessions } from "../../database/schema/users";
import { account, password, profile, userSchema, ok, empty } from "./schemas";
import { appSessionCookie, installAppAuthentication } from "./auth";
import { registerUserManagement, readUser } from "./management";
export async function registerUsers(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
  catalog: PermissionCatalog,
) {
  await installAppAuthentication(app, database, config, catalog);
  await registerUserManagement(app, database, config);
  const dummyHash = await hashPassword(newToken());
  const secure = { auth: true, authScope: "app" as const };
  app.post<{ Body: { account: string; password: string; nickname?: string } }>(
    "/api/app/auth/register",
    {
      config: { auth: false, rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["前台认证"],
        summary: "注册前台用户",
        description:
          "创建无角色的前台账号；注册后调用登录接口。不能提交状态、角色或额外资料。",
        body: Type.Object(
          { account, password, nickname: Type.Optional(profile.nickname) },
          { additionalProperties: false },
        ),
        response: ok,
      },
    },
    async (request) => {
      await database.db.insert(appUsers).values({
        account: request.body.account.toLowerCase(),
        nickname: request.body.nickname?.trim() ?? "",
        passwordHash: await hashPassword(request.body.password),
      });
      return { ok: true };
    },
  );
  app.post<{ Body: { account: string; password: string } }>(
    "/api/app/auth/login",
    {
      config: { auth: false, rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["前台认证"],
        summary: "前台用户登录",
        description:
          "使用独立前台会话；Bearer 返回 token，Cookie 模式设置 mas_app_session 并返回 CSRF 令牌。",
        body: Type.Object(
          {
            account,
            password: Type.String({
              minLength: 1,
              maxLength: 128,
              description: "登录密码",
            }),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            token: Type.Optional(Type.String({ description: "Bearer 令牌" })),
            csrfToken: Type.Optional(
              Type.String({ description: "Cookie 写请求 CSRF 凭证" }),
            ),
            expiresAt: Type.String({ description: "会话过期时间" }),
          }),
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const [candidate] = await database.db
        .select()
        .from(appUsers)
        .where(eq(appUsers.account, request.body.account.toLowerCase()));
      const valid = await Bun.password.verify(
        request.body.password,
        candidate?.passwordHash ?? dummyHash,
      );
      if (!candidate || !valid || candidate.status !== "enabled")
        throw new AppError("LOGIN_FAILED", "账号或密码错误", 401);
      const token = newToken();
      const expiresAt = new Date(
        Date.now() + config.AUTH_SESSION_HOURS * 3600000,
      );
      await database.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(appUsers)
          .where(eq(appUsers.id, candidate.id))
          .for("update");
        if (
          !current ||
          current.status !== "enabled" ||
          current.passwordHash !== candidate.passwordHash
        )
          throw new AppError("LOGIN_FAILED", "账号或密码错误", 401);
        await tx.insert(appUserSessions).values({
          userId: current.id,
          tokenHash: hashToken(token),
          transport: config.AUTH_TRANSPORT,
          expiresAt,
        });
        await tx
          .update(appUsers)
          .set({ lastLoginAt: new Date() })
          .where(eq(appUsers.id, current.id));
      });
      if (config.AUTH_TRANSPORT === "cookie") {
        reply.setCookie(appSessionCookie, token, {
          httpOnly: true,
          secure: config.APP_ENV === "production",
          sameSite: "strict",
          path: "/api/app",
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
    "/api/app/auth/me",
    {
      config: secure,
      schema: {
        tags: ["前台认证"],
        summary: "前台当前用户",
        description:
          "只返回当前用户的资料与实时前台权限，不包含密码或会话哈希。",
        response: {
          200: Type.Object({
            user: { ...userSchema, description: "本人资料" },
            permissions: Type.Array(Type.String(), {
              description: "本人前台权限",
            }),
            csrfToken: Type.Optional(
              Type.String({ description: "Cookie 写请求 CSRF 凭证" }),
            ),
          }),
        },
      },
    },
    async (request) => ({
      user: await readUser(database.db, request.appIdentity!.id),
      permissions: request.appIdentity!.permissions,
      ...(config.AUTH_TRANSPORT === "cookie"
        ? { csrfToken: request.appIdentity!.csrfToken }
        : {}),
    }),
  );
  app.put<{ Body: { nickname: string; avatar: string } }>(
    "/api/app/auth/me",
    {
      config: secure,
      schema: {
        tags: ["前台认证"],
        summary: "修改个人资料",
        description: "仅修改本人昵称和头像；metadata 由后台维护。",
        body: Type.Object(profile, { additionalProperties: false }),
        response: ok,
      },
    },
    async (request) => {
      await database.db
        .update(appUsers)
        .set({
          nickname: request.body.nickname.trim(),
          avatar: request.body.avatar,
          updatedAt: new Date(),
        })
        .where(eq(appUsers.id, request.appIdentity!.id));
      return { ok: true };
    },
  );
  app.post<{ Body: { oldPassword: string; password: string } }>(
    "/api/app/auth/password",
    {
      config: secure,
      schema: {
        tags: ["前台认证"],
        summary: "修改本人密码",
        description: "校验原密码并修改，撤销全部前台会话，需要重新登录。",
        body: Type.Object(
          {
            oldPassword: Type.String({
              minLength: 1,
              maxLength: 128,
              description: "当前密码",
            }),
            password,
          },
          { additionalProperties: false },
        ),
        response: ok,
      },
    },
    async (request) => {
      const passwordHash = await hashPassword(request.body.password);
      await database.db.transaction(async (tx) => {
        const [user] = await tx
          .select()
          .from(appUsers)
          .where(eq(appUsers.id, request.appIdentity!.id))
          .for("update");
        if (
          !user ||
          !(await Bun.password.verify(
            request.body.oldPassword,
            user.passwordHash,
          ))
        )
          throw new AppError("PASSWORD_INVALID", "原密码不正确", 400);
        await tx
          .update(appUsers)
          .set({ passwordHash, updatedAt: new Date() })
          .where(eq(appUsers.id, user.id));
        await tx
          .update(appUserSessions)
          .set({ revokedAt: new Date() })
          .where(eq(appUserSessions.userId, user.id));
      });
      return { ok: true };
    },
  );
  app.post(
    "/api/app/auth/logout",
    {
      config: secure,
      schema: {
        tags: ["前台认证"],
        summary: "前台退出登录",
        description: "撤销当前前台会话，不影响后台登录。",
        body: empty,
        response: ok,
      },
    },
    async (request, reply) => {
      await database.db
        .update(appUserSessions)
        .set({ revokedAt: new Date() })
        .where(eq(appUserSessions.id, request.appIdentity!.sessionId));
      if (config.AUTH_TRANSPORT === "cookie")
        reply.clearCookie(appSessionCookie, { path: "/api/app" });
      return { ok: true };
    },
  );
}
