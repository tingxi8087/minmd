import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import { and, eq, count, desc, inArray } from "drizzle-orm";
import type { Database } from "../../../../../system/server/src/database/client";
import type { AppConfig } from "../../../../../system/server/src/config/env";
import {
  writeAudit,
  type Transaction,
} from "../../../../../system/server/src/modules/audit/service";
import { AppError } from "../../../../../system/server/src/errors";
import { spaces, spaceMembers } from "../../database/schema/spaces";
import { appUsers } from "../../database/schema/users";
import {
  lockSpace,
  requireSpaceOwner,
  requireSpaceAccess,
  spaceResponse,
} from "./service";
import {
  id,
  spaceSchema,
  userSchema,
  spaceParams,
  createBody,
  patchBody,
  memberBody,
  pagination,
  listResponse,
  errors,
  ok,
  type CreateBody,
  type PatchBody,
} from "./schemas";
export { requireSpaceAccess, lockSpace } from "./service";
export interface SpaceOptions {
  beforeDelete?: (tx: Transaction, spaceId: string) => Promise<void>;
  onMemberRemoved?: (spaceId: string, userId: string) => Promise<void>;
}
export async function registerSpaces(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
  options: SpaceOptions = {},
) {
  const readSpace = async (tx: Transaction, spaceId: string) => {
    const [space] = await tx
      .select()
      .from(spaces)
      .where(eq(spaces.id, spaceId));
    if (!space) throw new AppError("NOT_FOUND", "空间不存在", 404);
    return space;
  };
  const enabledUser = async (tx: Transaction, userId: string) => {
    const [user] = await tx
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(and(eq(appUsers.id, userId), eq(appUsers.status, "enabled")))
      .for("share");
    if (!user)
      throw new AppError("USER_UNAVAILABLE", "账号不存在或已停用", 400);
  };
  for (const admin of [false, true]) {
    const base = admin ? "/api/admin/spaces" : "/api/app/spaces";
    const auth = (write = false) =>
      admin
        ? { auth: true, permissions: [write ? "space:update" : "space:read"] }
        : { auth: true, authScope: "app" as const };
    const meta = (summary: string) => ({
      tags: [admin ? "后台空间管理" : "空间管理"],
      summary,
      description: admin
        ? "仅后台相应权限可操作空间资料与成员，不授予私有正文访问权。"
        : "当前前台身份访问所属空间；空间资料与成员变更仅负责人可执行。",
    });
    const audit = async (
      tx: Transaction,
      request: FastifyRequest,
      action: string,
      spaceId: string,
      after: Record<string, unknown>,
    ) => {
      if (admin)
        await writeAudit(tx, request, config.APP_ENV, {
          action,
          targetType: "space",
          targetId: spaceId,
          after,
          result: "success",
        });
    };
    const mutate = async <T>(
      request: FastifyRequest,
      spaceId: string,
      operation: (
        tx: Transaction,
        space: typeof spaces.$inferSelect,
      ) => Promise<T>,
    ) =>
      database.db.transaction(async (tx) => {
        await lockSpace(tx, spaceId);
        const space = admin
          ? await readSpace(tx, spaceId)
          : await requireSpaceOwner(tx, request.appIdentity!.id, spaceId);
        return operation(tx, space);
      });
    app.get<{ Querystring: { page?: number; pageSize?: number } }>(
      base,
      {
        config: auth(),
        schema: {
          ...meta("空间列表"),
          querystring: pagination,
          response: { 200: listResponse, ...errors },
        },
      },
      async (request) => {
        const pageSize = request.query.pageSize ?? 50;
        const memberIds = admin
          ? undefined
          : database.db
              .select({ id: spaceMembers.spaceId })
              .from(spaceMembers)
              .where(eq(spaceMembers.userId, request.appIdentity!.id));
        const condition = memberIds ? inArray(spaces.id, memberIds) : undefined;
        const [result] = await database.db
          .select({ total: count() })
          .from(spaces)
          .where(condition);
        const total = result!.total;
        const page = Math.min(
          request.query.page ?? 1,
          Math.max(1, Math.ceil(total / pageSize)),
        );
        const items = await database.db
          .select()
          .from(spaces)
          .where(condition)
          .orderBy(desc(spaces.createdAt), spaces.id)
          .limit(pageSize)
          .offset((page - 1) * pageSize);
        return { items: items.map(spaceResponse), total, page, pageSize };
      },
    );
    app.post<{ Body: CreateBody & { ownerId?: string } }>(
      base,
      {
        config: auth(true),
        schema: {
          ...meta("创建空间"),
          body: admin
            ? Type.Object(
                { ...createBody.properties, ownerId: id },
                { additionalProperties: false },
              )
            : createBody,
          response: { 200: spaceSchema, ...errors },
        },
      },
      async (request) =>
        database.db.transaction(async (tx) => {
          const ownerId = admin
            ? request.body.ownerId!
            : request.appIdentity!.id;
          await enabledUser(tx, ownerId);
          const [space] = await tx
            .insert(spaces)
            .values({
              name: request.body.name.trim(),
              description: request.body.description ?? "",
              ownerId,
            })
            .returning();
          await tx
            .insert(spaceMembers)
            .values({ spaceId: space!.id, userId: ownerId });
          await audit(tx, request, "space.create", space!.id, {
            name: space!.name,
            ownerId,
          });
          return spaceResponse(space!);
        }),
    );
    app.get<{ Params: { spaceId: string } }>(
      `${base}/:spaceId`,
      {
        config: auth(),
        schema: {
          ...meta("空间详情"),
          params: spaceParams,
          response: { 200: spaceSchema, ...errors },
        },
      },
      async (request) => {
        if (!admin)
          return spaceResponse(
            await requireSpaceAccess(
              database,
              request.appIdentity!.id,
              request.params.spaceId,
            ),
          );
        const [space] = await database.db
          .select()
          .from(spaces)
          .where(eq(spaces.id, request.params.spaceId));
        if (!space) throw new AppError("NOT_FOUND", "空间不存在", 404);
        return spaceResponse(space);
      },
    );
    app.patch<{ Params: { spaceId: string }; Body: PatchBody }>(
      `${base}/:spaceId`,
      {
        config: auth(true),
        schema: {
          ...meta("修改空间资料"),
          params: spaceParams,
          body: patchBody,
          response: { 200: spaceSchema, ...errors },
        },
      },
      async (request) =>
        mutate(request, request.params.spaceId, async (tx) => {
          const [space] = await tx
            .update(spaces)
            .set({
              ...request.body,
              ...(request.body.name ? { name: request.body.name.trim() } : {}),
              updatedAt: new Date(),
            })
            .where(eq(spaces.id, request.params.spaceId))
            .returning();
          await audit(tx, request, "space.update", space!.id, {
            name: space!.name,
            description: space!.description,
          });
          return spaceResponse(space!);
        }),
    );
    app.post<{ Params: { spaceId: string }; Body: { userId: string } }>(
      `${base}/:spaceId/transfer-owner`,
      {
        config: auth(true),
        schema: {
          ...meta("转移空间负责人"),
          params: spaceParams,
          body: memberBody,
          response: { 200: spaceSchema, ...errors },
        },
      },
      async (request) =>
        mutate(request, request.params.spaceId, async (tx) => {
          await enabledUser(tx, request.body.userId);
          const [member] = await tx
            .select()
            .from(spaceMembers)
            .where(
              and(
                eq(spaceMembers.spaceId, request.params.spaceId),
                eq(spaceMembers.userId, request.body.userId),
              ),
            );
          if (!member)
            throw new AppError(
              "MEMBER_REQUIRED",
              "新负责人必须已是空间成员",
              400,
            );
          const [space] = await tx
            .update(spaces)
            .set({ ownerId: request.body.userId, updatedAt: new Date() })
            .where(eq(spaces.id, request.params.spaceId))
            .returning();
          await audit(tx, request, "space.transfer", space!.id, {
            ownerId: space!.ownerId,
          });
          return spaceResponse(space!);
        }),
    );
    app.delete<{ Params: { spaceId: string } }>(
      `${base}/:spaceId`,
      {
        config: auth(true),
        schema: { ...meta("删除空空间"), params: spaceParams, response: ok },
      },
      async (request) =>
        mutate(request, request.params.spaceId, async (tx) => {
          // 文件模块必须在同一事务检查回收站在内的全部文件；不允许非空空间批量清除。
          if (options.beforeDelete)
            await options.beforeDelete(tx, request.params.spaceId);
          await tx.delete(spaces).where(eq(spaces.id, request.params.spaceId));
          await audit(tx, request, "space.delete", request.params.spaceId, {});
          return { ok: true };
        }),
    );
    app.get<{
      Params: { spaceId: string };
      Querystring: { page?: number; pageSize?: number };
    }>(
      `${base}/:spaceId/members`,
      {
        config: auth(),
        schema: {
          ...meta("空间成员列表"),
          params: spaceParams,
          querystring: pagination,
          response: {
            200: Type.Object({
              items: Type.Array(
                Type.Object({
                  ...userSchema.properties,
                  joinedAt: Type.String({ description: "加入时间" }),
                  role: Type.Union(
                    [Type.Literal("owner"), Type.Literal("member")],
                    { description: "空间身份" },
                  ),
                }),
                { description: "空间成员列表" },
              ),
              total: Type.Integer({ description: "总条数" }),
              page: Type.Integer({ description: "当前页码" }),
              pageSize: Type.Integer({ description: "每页条数" }),
            }),
            ...errors,
          },
        },
      },
      async (request) => {
        const space = admin
          ? (
              await database.db
                .select()
                .from(spaces)
                .where(eq(spaces.id, request.params.spaceId))
            )[0]
          : await requireSpaceAccess(
              database,
              request.appIdentity!.id,
              request.params.spaceId,
            );
        if (!space) throw new AppError("NOT_FOUND", "空间不存在", 404);
        const [result] = await database.db
          .select({ total: count() })
          .from(spaceMembers)
          .where(eq(spaceMembers.spaceId, space.id));
        const total = result!.total;
        const pageSize = request.query.pageSize ?? 50;
        const page = Math.min(
          request.query.page ?? 1,
          Math.max(1, Math.ceil(total / pageSize)),
        );
        const items = await database.db
          .select({
            id: appUsers.id,
            account: appUsers.account,
            nickname: appUsers.nickname,
            avatar: appUsers.avatar,
            joinedAt: spaceMembers.joinedAt,
          })
          .from(spaceMembers)
          .innerJoin(appUsers, eq(appUsers.id, spaceMembers.userId))
          .where(eq(spaceMembers.spaceId, space.id))
          .orderBy(spaceMembers.joinedAt, appUsers.id)
          .limit(pageSize)
          .offset((page - 1) * pageSize);
        return {
          items: items.map((user) => ({
            ...user,
            joinedAt: user.joinedAt.toISOString(),
            role: user.id === space.ownerId ? "owner" : "member",
          })),
          total,
          page,
          pageSize,
        };
      },
    );
    app.post<{ Params: { spaceId: string }; Body: { userId: string } }>(
      `${base}/:spaceId/members`,
      {
        config: auth(true),
        schema: {
          ...meta("添加已有账号为成员"),
          params: spaceParams,
          body: memberBody,
          response: ok,
        },
      },
      async (request) =>
        mutate(request, request.params.spaceId, async (tx) => {
          await enabledUser(tx, request.body.userId);
          await tx
            .insert(spaceMembers)
            .values({
              spaceId: request.params.spaceId,
              userId: request.body.userId,
            })
            .onConflictDoNothing();
          await audit(tx, request, "space.member.add", request.params.spaceId, {
            userId: request.body.userId,
          });
          return { ok: true };
        }),
    );
    app.delete<{ Params: { spaceId: string; userId: string } }>(
      `${base}/:spaceId/members/:userId`,
      {
        config: auth(true),
        schema: {
          ...meta("移除空间成员"),
          params: Type.Object({ spaceId: id, userId: id }),
          response: ok,
        },
      },
      async (request) => {
        await mutate(request, request.params.spaceId, async (tx, space) => {
          if (space.ownerId === request.params.userId)
            throw new AppError(
              "OWNER_CANNOT_REMOVE",
              "请先转移负责人再移除成员",
              409,
            );
          await tx
            .delete(spaceMembers)
            .where(
              and(
                eq(spaceMembers.spaceId, space.id),
                eq(spaceMembers.userId, request.params.userId),
              ),
            );
          await audit(tx, request, "space.member.remove", space.id, {
            userId: request.params.userId,
          });
        });
        await options.onMemberRemoved?.(
          request.params.spaceId,
          request.params.userId,
        );
        return { ok: true };
      },
    );
    app.get<{ Params: { spaceId: string }; Querystring: { q: string } }>(
      `${base}/:spaceId/accounts`,
      {
        config: auth(true),
        schema: {
          ...meta("按账号查找可添加的成员"),
          params: spaceParams,
          querystring: Type.Object(
            {
              q: Type.String({
                minLength: 3,
                maxLength: 64,
                description: "完整账号精确匹配，不公开全量用户目录",
              }),
            },
            { additionalProperties: false },
          ),
          response: {
            200: Type.Object({
              items: Type.Array(userSchema, { description: "匹配账号列表" }),
            }),
            ...errors,
          },
        },
      },
      async (request) => {
        if (!admin)
          await requireSpaceOwner(
            database.db,
            request.appIdentity!.id,
            request.params.spaceId,
          );
        const items = await database.db
          .select({
            id: appUsers.id,
            account: appUsers.account,
            nickname: appUsers.nickname,
            avatar: appUsers.avatar,
          })
          .from(appUsers)
          .where(
            and(
              eq(appUsers.account, request.query.q.toLowerCase()),
              eq(appUsers.status, "enabled"),
            ),
          )
          .limit(1);
        return { items };
      },
    );
  }
}
