import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { and, eq, count, desc, inArray, or, ilike, sql } from "drizzle-orm";
import type { Database } from "../../../../../system/server/src/database/client";
import type { AppConfig } from "../../../../../system/server/src/config/env";
import { roles } from "../../../../../system/server/src/database/schema/system";
import { AppError } from "../../../../../system/server/src/errors";
import { hashPassword } from "../../../../../system/server/src/modules/auth/password";
import {
  writeAudit,
  type Transaction,
} from "../../../../../system/server/src/modules/audit/service";
import {
  appUsers,
  appUserRoles,
  appUserSessions,
} from "../../database/schema/users";
import {
  adminFields,
  password,
  params,
  status,
  userSchema,
  ok,
  empty,
  type UserInput,
} from "./schemas";
/** 显式输出白名单，避免密码哈希泄漏到响应或审计。 */
export async function readUser(db: Database["db"] | Transaction, id: string) {
  const [row] = await db
    .select({
      id: appUsers.id,
      account: appUsers.account,
      nickname: appUsers.nickname,
      avatar: appUsers.avatar,
      status: appUsers.status,
      metadata: appUsers.metadata,
      createdAt: appUsers.createdAt,
      updatedAt: appUsers.updatedAt,
      lastLoginAt: appUsers.lastLoginAt,
    })
    .from(appUsers)
    .where(eq(appUsers.id, id));
  if (!row) throw new AppError("NOT_FOUND", "前台用户不存在", 404);
  const assigned = await db
    .select({ id: roles.id })
    .from(appUserRoles)
    .innerJoin(
      roles,
      and(eq(roles.id, appUserRoles.roleId), eq(roles.scope, "app")),
    )
    .where(eq(appUserRoles.userId, id));
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    roles: assigned.map((r) => r.id),
  };
}
export async function registerUserManagement(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
) {
  // 与系统角色变更共用锁，避免角色校验和分配之间发生并发删除。
  const transaction = <T>(fn: (tx: Transaction) => Promise<T>) =>
    database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(731904203)`);
      return fn(tx);
    });
  const assignRoles = async (tx: Transaction, id: string, ids: string[]) => {
    if (ids.length) {
      const found = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(inArray(roles.id, ids), eq(roles.scope, "app")));
      if (found.length !== ids.length)
        throw new AppError("INVALID_ROLE", "只能分配存在的前台角色");
    }
    await tx.delete(appUserRoles).where(eq(appUserRoles.userId, id));
    if (ids.length)
      await tx
        .insert(appUserRoles)
        .values(ids.map((roleId) => ({ userId: id, roleId })));
  };
  app.get<{
    Querystring: {
      page?: number;
      pageSize?: number;
      keyword?: string;
      status?: string;
    };
  }>(
    "/api/admin/app-users",
    {
      config: { auth: true, permissions: ["app-user:read"] },
      schema: {
        tags: ["前台用户管理"],
        summary: "查询前台用户",
        description: "按账号或昵称搜索、按状态筛选并分页；不返回密码哈希。",
        querystring: Type.Object({
          page: Type.Optional(
            Type.Integer({ minimum: 1, description: "页码" }),
          ),
          pageSize: Type.Optional(
            Type.Integer({
              minimum: 1,
              maximum: 100,
              description: "每页条数，最多 100",
            }),
          ),
          keyword: Type.Optional(
            Type.String({ maxLength: 64, description: "账号或昵称关键词" }),
          ),
          status: Type.Optional(status),
        }),
        response: {
          200: Type.Object({
            items: Type.Array(userSchema, { description: "当前页用户列表" }),
            total: Type.Number({ description: "总记录数" }),
            page: Type.Number({ description: "当前页码" }),
            pageSize: Type.Number({ description: "每页条数" }),
          }),
        },
      },
    },
    async (request) => {
      const { page = 1, pageSize = 20, keyword, status } = request.query;
      const where = and(
        keyword
          ? or(
              ilike(appUsers.account, `%${keyword}%`),
              ilike(appUsers.nickname, `%${keyword}%`),
            )
          : undefined,
        status ? eq(appUsers.status, status) : undefined,
      );
      const [total] = await database.db
        .select({ value: count() })
        .from(appUsers)
        .where(where);
      const currentPage = Math.max(
        1,
        Math.min(page, Math.ceil(total!.value / pageSize) || 1),
      );
      const rows = await database.db
        .select({ id: appUsers.id })
        .from(appUsers)
        .where(where)
        .orderBy(desc(appUsers.createdAt), appUsers.id)
        .limit(pageSize)
        .offset((currentPage - 1) * pageSize);
      return {
        items: await Promise.all(
          rows.map((row) => readUser(database.db, row.id)),
        ),
        total: total!.value,
        page: currentPage,
        pageSize,
      };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/admin/app-users/:id",
    {
      config: { auth: true, permissions: ["app-user:read"] },
      schema: {
        tags: ["前台用户管理"],
        summary: "前台用户详情",
        description: "读取指定前台用户资料和前台角色。",
        params,
        response: { 200: userSchema },
      },
    },
    (request) => readUser(database.db, request.params.id),
  );
  for (const edit of [false, true]) {
    app.route<{
      Params: { id: string };
      Body: UserInput & { password?: string };
    }>({
      method: edit ? "PUT" : "POST",
      url: edit ? "/api/admin/app-users/:id" : "/api/admin/app-users",
      config: {
        auth: true,
        permissions: [edit ? "app-user:update" : "app-user:create"],
      },
      schema: {
        tags: ["前台用户管理"],
        summary: edit ? "编辑前台用户" : "创建前台用户",
        description:
          "维护基础资料、额外资料和前台角色。状态与密码通过单独接口修改。",
        ...(edit ? { params } : {}),
        body: Type.Object(
          { ...adminFields, ...(!edit ? { password } : {}) },
          { additionalProperties: false },
        ),
        response: ok,
      },
      handler: async (request) => {
        const passwordHash = edit
          ? undefined
          : await hashPassword(request.body.password!);
        await transaction(async (tx) => {
          let id = request.params.id;
          let before: Record<string, unknown> | undefined;
          if (edit) {
            await tx
              .select()
              .from(appUsers)
              .where(eq(appUsers.id, id))
              .for("update");
            before = await readUser(tx, id);
          }
          const values = {
            account: request.body.account.toLowerCase(),
            nickname: request.body.nickname.trim(),
            avatar: request.body.avatar,
            metadata: request.body.metadata,
            updatedAt: new Date(),
          };
          if (edit)
            await tx.update(appUsers).set(values).where(eq(appUsers.id, id));
          else {
            const [row] = await tx
              .insert(appUsers)
              .values({ ...values, passwordHash: passwordHash! })
              .returning({ id: appUsers.id });
            id = row!.id;
          }
          await assignRoles(tx, id, request.body.roles);
          // 自定义 metadata 可能包含敏感资料，不写入审计副本。
          const after = {
            account: values.account,
            nickname: values.nickname,
            roles: request.body.roles,
            metadataUpdated: true,
          };
          await writeAudit(tx, request, config.APP_ENV, {
            action: edit ? "app-user.update" : "app-user.create",
            targetType: "app-user",
            targetId: id,
            result: "success",
            before: before
              ? {
                  account: before.account,
                  nickname: before.nickname,
                  roles: before.roles,
                }
              : undefined,
            after,
          });
        });
        return { ok: true };
      },
    });
  }
  for (const action of ["status", "password", "revoke"] as const) {
    const permission = {
      status: "app-user:disable",
      password: "app-user:reset-password",
      revoke: "app-user:revoke",
    }[action];
    app.post<{
      Params: { id: string };
      Body: { status?: "enabled" | "disabled"; password?: string };
    }>(
      `/api/admin/app-users/:id/${action}`,
      {
        config: { auth: true, permissions: [permission] },
        schema: {
          tags: ["前台用户管理"],
          summary: {
            status: "启停前台用户",
            password: "重置前台用户密码",
            revoke: "前台用户强制下线",
          }[action],
          description:
            "停用、重置密码和强制下线会撤销该用户全部前台会话。启用不会恢复旧会话。",
          params,
          body:
            action === "status"
              ? Type.Object({ status }, { additionalProperties: false })
              : action === "password"
                ? Type.Object({ password }, { additionalProperties: false })
                : empty,
          response: ok,
        },
      },
      async (request) => {
        const passwordHash =
          action === "password"
            ? await hashPassword(request.body.password!)
            : undefined;
        await transaction(async (tx) => {
          const id = request.params.id;
          const [row] = await tx
            .select({ id: appUsers.id })
            .from(appUsers)
            .where(eq(appUsers.id, id))
            .for("update");
          if (!row) throw new AppError("NOT_FOUND", "前台用户不存在", 404);
          if (action === "status")
            await tx
              .update(appUsers)
              .set({ status: request.body.status!, updatedAt: new Date() })
              .where(eq(appUsers.id, id));
          if (action === "password")
            await tx
              .update(appUsers)
              .set({ passwordHash, updatedAt: new Date() })
              .where(eq(appUsers.id, id));
          if (action !== "status" || request.body.status === "disabled")
            await tx
              .update(appUserSessions)
              .set({ revokedAt: new Date() })
              .where(eq(appUserSessions.userId, id));
          await writeAudit(tx, request, config.APP_ENV, {
            action: `app-user.${action}`,
            targetType: "app-user",
            targetId: id,
            result: "success",
            after:
              action === "status" ? { status: request.body.status } : undefined,
          });
        });
        return { ok: true };
      },
    );
  }
}
