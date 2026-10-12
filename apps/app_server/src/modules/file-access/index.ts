import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { and, eq, isNull, ilike, or, desc, sql } from "drizzle-orm";
import type { Database } from "../../../../../system/server/src/database/client";
import { AppError } from "../../../../../system/server/src/errors";
import { files } from "../../database/schema/files";
import { spaces } from "../../database/schema/spaces";
import { appUsers } from "../../database/schema/users";
import {
  fileAccessGrants,
  fileAccessRequests,
  appNotifications,
} from "../../database/schema/file-access";
import { requireFileAccess, fileResponses } from "../files/service";
import { fileSchema } from "../files/schemas";
import { lockSpace } from "../spaces/service";
import { id, errors, pagination } from "../spaces/schemas";
import { resolveFileAccess } from "./service";
const permission = Type.Union([Type.Literal("read"), Type.Literal("edit")], {
  description: "只读或可编辑",
});
const params = Type.Object({ fileId: id });
const empty = Type.Object({}, { additionalProperties: false });
const userSchema = Type.Object(
  {
    id,
    account: Type.String({ description: "账号" }),
    nickname: Type.String({ description: "昵称" }),
  },
  { description: "协作者最小账号资料" },
);
const grantSchema = Type.Object({ user: userSchema, permission });
const requestSchema = Type.Object({
  id,
  user: userSchema,
  permission,
  reason: Type.String({ description: "申请说明" }),
  status: Type.Union(
    [
      Type.Literal("pending"),
      Type.Literal("approved"),
      Type.Literal("rejected"),
      Type.Literal("cancelled"),
    ],
    { description: "申请处理状态" },
  ),
  createdAt: Type.String({ description: "申请时间" }),
});
const ok = {
  200: Type.Object({ ok: Type.Boolean({ description: "操作成功" }) }),
  ...errors,
};
const grantBody = Type.Object(
  { userId: id, permission },
  { additionalProperties: false },
);
const requestBody = Type.Object(
  {
    permission,
    reason: Type.Optional(
      Type.String({ maxLength: 500, description: "可选申请理由，最多500字" }),
    ),
  },
  { additionalProperties: false },
);
const decisionBody = Type.Object(
  {
    decision: Type.Union([Type.Literal("approve"), Type.Literal("reject")], {
      description: "批准或拒绝申请",
    }),
    permission: Type.Optional(permission),
  },
  { additionalProperties: false },
);
const toUser = (user: typeof appUsers.$inferSelect) => ({
  id: user.id,
  account: user.account,
  nickname: user.nickname,
});
export async function registerFileAccess(
  app: FastifyInstance,
  database: Database,
  options: { changed: (fileId: string) => void | Promise<void> },
) {
  const auth = { auth: true, authScope: "app" as const };
  const meta = (summary: string) => ({
    tags: ["文件权限"],
    summary,
    description:
      "使用前台身份；文件管理员为创建者或空间负责人。单文件授权不授予空间目录或其他文件权限，所有写操作在空间事务锁内复验。",
  });
  const lockedManager = async (
    tx: Parameters<Parameters<typeof database.db.transaction>[0]>[0],
    userId: string,
    fileId: string,
  ) => {
    const [initial] = await tx.select().from(files).where(eq(files.id, fileId));
    if (!initial) throw new AppError("NOT_FOUND", "文件不存在", 404);
    await lockSpace(tx, initial.spaceId);
    const file = await requireFileAccess(tx, userId, fileId, {
      permission: "manage",
    });
    // 与正文写入持有的共享文件锁互斥，确保授权变更不能穿过已通过校验的事务。
    await tx
      .select({ id: files.id })
      .from(files)
      .where(eq(files.id, file.id))
      .for("update");
    return file;
  };
  app.get<{ Params: { fileId: string } }>(
    "/api/app/files/:fileId/access",
    {
      config: auth,
      schema: {
        ...meta("读取我的文件权限与申请状态"),
        params,
        response: {
          200: Type.Object({
            permission: Type.Union(
              [permission, Type.Literal("manage"), Type.Null()],
              { description: "当前账号有效文件权限，null无权访问" },
            ),
            member: Type.Boolean({ description: "是否为当前文件所属空间成员" }),
            request: Type.Union(
              [
                Type.Object({
                  id,
                  permission,
                  status: requestSchema.properties.status,
                }),
                Type.Null(),
              ],
              { description: "当前账号的申请记录" },
            ),
          }),
          ...errors,
        },
      },
    },
    async (request) => {
      const [file] = await database.db
        .select()
        .from(files)
        .where(
          and(eq(files.id, request.params.fileId), isNull(files.deletedAt)),
        );
      if (!file) throw new AppError("NOT_FOUND", "文件不存在", 404);
      const userId = request.appIdentity!.id;
      const access = await resolveFileAccess(database.db, userId, file);
      const [pending] = await database.db
        .select()
        .from(fileAccessRequests)
        .where(
          and(
            eq(fileAccessRequests.fileId, file.id),
            eq(fileAccessRequests.userId, userId),
          ),
        );
      return {
        ...access,
        request: pending
          ? {
              id: pending.id,
              permission: pending.permission,
              status: pending.status,
            }
          : null,
      };
    },
  );
  app.get<{ Params: { fileId: string } }>(
    "/api/app/files/:fileId/access-settings",
    {
      config: auth,
      schema: {
        ...meta("读取成员授权与待审批申请"),
        params,
        response: {
          200: Type.Object({
            memberPermission: permission,
            grants: Type.Array(grantSchema, {
              description: "指定协作者授权列表",
            }),
            requests: Type.Array(requestSchema, {
              description: "待处理申请，最多100条",
            }),
          }),
          ...errors,
        },
      },
    },
    async (request) => {
      const file = await requireFileAccess(
        database,
        request.appIdentity!.id,
        request.params.fileId,
        { permission: "manage" },
      );
      const grants = await database.db
        .select({ grant: fileAccessGrants, user: appUsers })
        .from(fileAccessGrants)
        .innerJoin(appUsers, eq(appUsers.id, fileAccessGrants.userId))
        .where(eq(fileAccessGrants.fileId, file.id));
      const requests = await database.db
        .select({ item: fileAccessRequests, user: appUsers })
        .from(fileAccessRequests)
        .innerJoin(appUsers, eq(appUsers.id, fileAccessRequests.userId))
        .where(
          and(
            eq(fileAccessRequests.fileId, file.id),
            eq(fileAccessRequests.status, "pending"),
          ),
        )
        .orderBy(desc(fileAccessRequests.createdAt))
        .limit(100);
      return {
        memberPermission: file.memberPermission,
        grants: grants.map(({ grant, user }) => ({
          user: toUser(user),
          permission: grant.permission,
        })),
        requests: requests.map(({ item, user }) => ({
          id: item.id,
          user: toUser(user),
          permission: item.permission,
          reason: item.reason,
          status: item.status,
          createdAt: item.createdAt.toISOString(),
        })),
      };
    },
  );
  app.put<{
    Params: { fileId: string };
    Body: { permission: "read" | "edit" };
  }>(
    "/api/app/files/:fileId/member-permission",
    {
      config: auth,
      schema: {
        ...meta("设置空间成员默认文件权限"),
        params,
        body: Type.Object({ permission }, { additionalProperties: false }),
        response: ok,
      },
    },
    async (request) => {
      await database.db.transaction(async (tx) => {
        const file = await lockedManager(
          tx,
          request.appIdentity!.id,
          request.params.fileId,
        );
        await tx
          .update(files)
          .set({
            memberPermission: request.body.permission,
            updatedAt: new Date(),
            metadataRevision: sql`${files.metadataRevision}+1`,
          })
          .where(eq(files.id, file.id));
      });
      await options.changed(request.params.fileId);
      return { ok: true };
    },
  );
  app.put<{ Params: { fileId: string }; Body: Static<typeof grantBody> }>(
    "/api/app/files/:fileId/access-grants",
    {
      config: auth,
      schema: {
        ...meta("添加或更新指定用户权限"),
        params,
        body: grantBody,
        response: ok,
      },
    },
    async (request) => {
      await database.db.transaction(async (tx) => {
        const file = await lockedManager(
          tx,
          request.appIdentity!.id,
          request.params.fileId,
        );
        if (file.kind === "folder")
          throw new AppError(
            "FILE_KIND_INVALID",
            "请对具体文档、表格或幻灯片授权",
            400,
          );
        const [user] = await tx
          .select({ id: appUsers.id })
          .from(appUsers)
          .where(
            and(
              eq(appUsers.id, request.body.userId),
              eq(appUsers.status, "enabled"),
            ),
          )
          .for("share");
        if (!user)
          throw new AppError("USER_UNAVAILABLE", "用户不存在或已停用", 400);
        await tx
          .insert(fileAccessGrants)
          .values({
            fileId: file.id,
            userId: user.id,
            permission: request.body.permission,
            grantedBy: request.appIdentity!.id,
          })
          .onConflictDoUpdate({
            target: [fileAccessGrants.fileId, fileAccessGrants.userId],
            set: {
              permission: request.body.permission,
              grantedBy: request.appIdentity!.id,
              updatedAt: new Date(),
            },
          });
        await tx.insert(appNotifications).values({
          userId: user.id,
          fileId: file.id,
          message: `你已获得「${file.name}」的${request.body.permission === "edit" ? "编辑" : "只读"}权限`,
        });
      });
      await options.changed(request.params.fileId);
      return { ok: true };
    },
  );
  app.delete<{ Params: { fileId: string; userId: string } }>(
    "/api/app/files/:fileId/access-grants/:userId",
    {
      config: auth,
      schema: {
        ...meta("移除指定用户授权"),
        params: Type.Object({ fileId: id, userId: id }),
        response: ok,
      },
    },
    async (request) => {
      await database.db.transaction(async (tx) => {
        const file = await lockedManager(
          tx,
          request.appIdentity!.id,
          request.params.fileId,
        );
        await tx
          .delete(fileAccessGrants)
          .where(
            and(
              eq(fileAccessGrants.fileId, file.id),
              eq(fileAccessGrants.userId, request.params.userId),
            ),
          );
      });
      await options.changed(request.params.fileId);
      return { ok: true };
    },
  );
  app.get<{ Querystring: { q: string } }>(
    "/api/app/users/search",
    {
      config: auth,
      schema: {
        ...meta("按账号或昵称查找协作者"),
        querystring: Type.Object(
          {
            q: Type.String({
              minLength: 2,
              maxLength: 64,
              description: "至少两个字符",
            }),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            items: Type.Array(userSchema, {
              description: "匹配的可用账号，最多20条",
            }),
          }),
          ...errors,
        },
      },
    },
    async (request) => {
      const q = request.query.q.replace(/[\\%_]/g, "\\$&");
      const users = await database.db
        .select()
        .from(appUsers)
        .where(
          and(
            eq(appUsers.status, "enabled"),
            or(
              ilike(appUsers.account, `%${q}%`),
              ilike(appUsers.nickname, `%${q}%`),
            ),
          ),
        )
        .limit(20);
      return { items: users.map(toUser) };
    },
  );
  app.post<{ Params: { fileId: string }; Body: Static<typeof requestBody> }>(
    "/api/app/files/:fileId/access-requests",
    {
      config: { ...auth, rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        ...meta("申请文件访问或编辑权限"),
        params,
        body: requestBody,
        response: ok,
      },
    },
    async (request) => {
      await database.db.transaction(async (tx) => {
        const [file] = await tx
          .select()
          .from(files)
          .where(
            and(eq(files.id, request.params.fileId), isNull(files.deletedAt)),
          );
        if (!file || file.kind === "folder")
          throw new AppError("NOT_FOUND", "文件不存在", 404);
        await lockSpace(tx, file.spaceId);
        const access = await resolveFileAccess(
          tx,
          request.appIdentity!.id,
          file,
        );
        if (
          access.permission === "manage" ||
          access.permission === "edit" ||
          (access.permission === "read" && request.body.permission === "read")
        )
          throw new AppError(
            "ACCESS_ALREADY_GRANTED",
            "已经拥有所申请的权限",
            409,
          );
        const [existing] = await tx
          .select()
          .from(fileAccessRequests)
          .where(
            and(
              eq(fileAccessRequests.fileId, file.id),
              eq(fileAccessRequests.userId, request.appIdentity!.id),
            ),
          );
        if (existing?.status === "pending") return;
        await tx
          .insert(fileAccessRequests)
          .values({
            fileId: file.id,
            userId: request.appIdentity!.id,
            permission: request.body.permission,
            reason: request.body.reason?.trim() ?? "",
          })
          .onConflictDoUpdate({
            target: [fileAccessRequests.fileId, fileAccessRequests.userId],
            set: {
              permission: request.body.permission,
              reason: request.body.reason?.trim() ?? "",
              status: "pending",
              decidedAt: null,
              decidedBy: null,
              updatedAt: new Date(),
              createdAt: new Date(),
            },
          });
        const [space] = await tx
          .select()
          .from(spaces)
          .where(eq(spaces.id, file.spaceId));
        for (const userId of new Set([file.createdBy, space!.ownerId])) {
          try {
            if (
              (await resolveFileAccess(tx, userId, file)).permission !==
              "manage"
            )
              continue;
          } catch (error) {
            if (error instanceof AppError && error.statusCode === 401) continue;
            throw error;
          }
          await tx.insert(appNotifications).values({
            userId,
            fileId: file.id,
            message: `「${file.name}」有新的${request.body.permission === "edit" ? "编辑" : "访问"}权限申请`,
          });
        }
      });
      return { ok: true };
    },
  );
  app.delete<{ Params: { fileId: string } }>(
    "/api/app/files/:fileId/access-request",
    {
      config: auth,
      schema: { ...meta("取消自己的待处理申请"), params, response: ok },
    },
    async (request) => {
      await database.db
        .update(fileAccessRequests)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(fileAccessRequests.fileId, request.params.fileId),
            eq(fileAccessRequests.userId, request.appIdentity!.id),
            eq(fileAccessRequests.status, "pending"),
          ),
        );
      return { ok: true };
    },
  );
  app.post<{
    Params: { fileId: string; requestId: string };
    Body: Static<typeof decisionBody>;
  }>(
    "/api/app/files/:fileId/access-requests/:requestId/decision",
    {
      config: auth,
      schema: {
        ...meta("审批文件权限申请"),
        params: Type.Object({ fileId: id, requestId: id }),
        body: decisionBody,
        response: ok,
      },
    },
    async (request) => {
      await database.db.transaction(async (tx) => {
        const file = await lockedManager(
          tx,
          request.appIdentity!.id,
          request.params.fileId,
        );
        const [item] = await tx
          .select()
          .from(fileAccessRequests)
          .where(
            and(
              eq(fileAccessRequests.id, request.params.requestId),
              eq(fileAccessRequests.fileId, file.id),
            ),
          )
          .for("update");
        if (!item || item.status !== "pending")
          throw new AppError("REQUEST_NOT_PENDING", "申请不存在或已处理", 409);
        const approved = request.body.decision === "approve";
        const granted = request.body.permission ?? item.permission;
        if (approved)
          await tx
            .insert(fileAccessGrants)
            .values({
              fileId: file.id,
              userId: item.userId,
              permission: granted,
              grantedBy: request.appIdentity!.id,
            })
            .onConflictDoUpdate({
              target: [fileAccessGrants.fileId, fileAccessGrants.userId],
              set: {
                permission: granted,
                grantedBy: request.appIdentity!.id,
                updatedAt: new Date(),
              },
            });
        await tx
          .update(fileAccessRequests)
          .set({
            status: approved ? "approved" : "rejected",
            permission: approved ? granted : item.permission,
            decidedBy: request.appIdentity!.id,
            decidedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(fileAccessRequests.id, item.id));
        await tx.insert(appNotifications).values({
          userId: item.userId,
          fileId: file.id,
          message: approved
            ? `「${file.name}」的申请已批准，权限为${granted === "edit" ? "可编辑" : "只读"}`
            : `「${file.name}」的权限申请被拒绝`,
        });
      });
      await options.changed(request.params.fileId);
      return { ok: true };
    },
  );
  app.get(
    "/api/app/shared-with-me",
    {
      config: auth,
      schema: {
        ...meta("查看分享给我的文件"),
        response: {
          200: Type.Object({
            items: Type.Array(fileSchema, {
              description: "单独授权给当前账号的文件",
            }),
          }),
          ...errors,
        },
      },
    },
    async (request) => {
      const rows = await database.db
        .select({ file: files })
        .from(fileAccessGrants)
        .innerJoin(files, eq(files.id, fileAccessGrants.fileId))
        .where(
          and(
            eq(fileAccessGrants.userId, request.appIdentity!.id),
            isNull(files.deletedAt),
          ),
        )
        .orderBy(desc(fileAccessGrants.updatedAt));
      return {
        items: await fileResponses(
          database.db,
          request.appIdentity!.id,
          rows.map((row) => row.file),
        ),
      };
    },
  );
  app.get<{ Querystring: { page: number; pageSize: number } }>(
    "/api/app/notifications",
    {
      config: auth,
      schema: {
        ...meta("读取当前账号站内通知"),
        querystring: pagination,
        response: {
          200: Type.Object({
            items: Type.Array(
              Type.Object({
                id,
                fileId: Type.Union([id, Type.Null()]),
                message: Type.String({ description: "通知内容" }),
                readAt: Type.Union([Type.String(), Type.Null()], {
                  description: "已读时间，null为未读",
                }),
                createdAt: Type.String({ description: "通知创建时间" }),
              }),
              { description: "当前账号通知列表" },
            ),
            total: Type.Integer({ description: "通知总数" }),
            unreadCount: Type.Integer({
              minimum: 0,
              description: "当前账号未读通知数量",
            }),
            page: Type.Integer({ description: "当前页码" }),
            pageSize: Type.Integer({ description: "每页条数" }),
          }),
          ...errors,
        },
      },
    },
    async (request) => {
      const { page: requestedPage = 1, pageSize = 20 } = request.query;
      const condition = eq(appNotifications.userId, request.appIdentity!.id);
      const [total] = await database.db
        .select({ value: sql<number>`count(*)::int` })
        .from(appNotifications)
        .where(condition);
      const page = Math.min(
        requestedPage,
        Math.max(1, Math.ceil(total!.value / pageSize)),
      );
      const items = await database.db
        .select()
        .from(appNotifications)
        .where(condition)
        .orderBy(desc(appNotifications.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const [unread] = await database.db
        .select({ value: sql<number>`count(*)::int` })
        .from(appNotifications)
        .where(and(condition, isNull(appNotifications.readAt)));
      return {
        unreadCount: unread!.value,
        items: items.map((item) => ({
          id: item.id,
          fileId: item.fileId,
          message: item.message,
          readAt: item.readAt?.toISOString() ?? null,
          createdAt: item.createdAt.toISOString(),
        })),
        total: total!.value,
        page,
        pageSize,
      };
    },
  );
  app.put<{ Params: { notificationId: string }; Body: Record<string, never> }>(
    "/api/app/notifications/:notificationId/read",
    {
      config: auth,
      schema: {
        ...meta("标记自己的通知为已读"),
        params: Type.Object({ notificationId: id }),
        body: empty,
        response: ok,
      },
    },
    async (request) => {
      await database.db
        .update(appNotifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(appNotifications.id, request.params.notificationId),
            eq(appNotifications.userId, request.appIdentity!.id),
          ),
        );
      return { ok: true };
    },
  );
}
