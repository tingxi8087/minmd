import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { and, eq, desc } from "drizzle-orm";
import type { Database } from "../../../../../system/server/src/database/client";
import { AppError } from "../../../../../system/server/src/errors";
import {
  newToken,
  hashToken,
} from "../../../../../system/server/src/modules/auth/password";
import {
  apiKeys,
  spaceAiPolicies,
  aiPermissions,
} from "../../database/schema/ai";
import {
  lockSpace,
  requireSpaceAccess,
  requireSpaceOwner,
} from "../spaces/service";
import { id, errors, spaceParams } from "../spaces/schemas";

const permission = Type.Union(
  aiPermissions.map((value) => Type.Literal(value)),
  { description: "读取、创建、编辑、整理、删除恢复或上传" },
);
const permissions = Type.Array(permission, {
  uniqueItems: true,
  maxItems: 6,
  description: "显式操作权限集合",
});
const policy = Type.Object(
  { enabled: Type.Boolean({ description: "空间AI总开关" }), permissions },
  { additionalProperties: false },
);
const keySchema = Type.Object({
  id,
  spaceId: id,
  createdBy: id,
  name: Type.String({ description: "密钥名称" }),
  prefix: Type.String({ description: "用于识别的密钥前缀" }),
  permissions,
  expiresAt: Type.Union([Type.String(), Type.Null()], {
    description: "到期时间，null表示长期有效",
  }),
  revokedAt: Type.Union([Type.String(), Type.Null()], {
    description: "撤销时间",
  }),
  lastUsedAt: Type.Union([Type.String(), Type.Null()], {
    description: "最后调用时间",
  }),
  createdAt: Type.String({ description: "创建时间" }),
});
const createBody = Type.Object(
  {
    name: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "\\S",
      description: "密钥名称",
    }),
    permissions: Type.Optional(permissions),
    expiresAt: Type.Optional(
      Type.Union([Type.String({ format: "date-time" }), Type.Null()], {
        description: "到期时间，必须晚于当前时间",
      }),
    ),
  },
  { additionalProperties: false },
);
function response(key: typeof apiKeys.$inferSelect) {
  return {
    id: key.id,
    spaceId: key.spaceId,
    createdBy: key.createdBy,
    name: key.name,
    prefix: key.prefix,
    permissions: key.permissions,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  };
}
export async function registerApiKeys(
  app: FastifyInstance,
  database: Database,
) {
  const auth = { auth: true, authScope: "app" as const };
  const meta = (summary: string, description: string) => ({
    tags: ["空间AI与密钥"],
    summary,
    description,
  });
  app.get<{ Params: { spaceId: string } }>(
    "/api/app/spaces/:spaceId/ai-policy",
    {
      config: auth,
      schema: {
        ...meta(
          "读取空间AI策略",
          "空间成员读取当前策略；新空间默认关闭，总开关开启后仍受显式操作权限约束。",
        ),
        params: spaceParams,
        response: { 200: policy, ...errors },
      },
    },
    async (request) => {
      await requireSpaceAccess(
        database,
        request.appIdentity!.id,
        request.params.spaceId,
      );
      const [current] = await database.db
        .select()
        .from(spaceAiPolicies)
        .where(eq(spaceAiPolicies.spaceId, request.params.spaceId));
      return current
        ? { enabled: current.enabled, permissions: current.permissions }
        : { enabled: false, permissions: ["read"] };
    },
  );
  app.put<{ Params: { spaceId: string }; Body: Static<typeof policy> }>(
    "/api/app/spaces/:spaceId/ai-policy",
    {
      config: auth,
      schema: {
        ...meta(
          "设置空间AI策略",
          "仅空间负责人可操作，关闭权限会立即影响所有密钥的后续调用；重新开启不会扩大已签发密钥范围。",
        ),
        params: spaceParams,
        body: policy,
        response: { 200: policy, ...errors },
      },
    },
    (request) =>
      database.db.transaction(async (tx) => {
        const spaceId = request.params.spaceId;
        await lockSpace(tx, spaceId);
        await requireSpaceOwner(tx, request.appIdentity!.id, spaceId);
        await tx
          .insert(spaceAiPolicies)
          .values({ spaceId, ...request.body })
          .onConflictDoUpdate({
            target: spaceAiPolicies.spaceId,
            set: { ...request.body, updatedAt: new Date() },
          });
        return request.body;
      }),
  );
  app.get<{ Params: { spaceId: string } }>(
    "/api/app/spaces/:spaceId/api-keys",
    {
      config: auth,
      schema: {
        ...meta(
          "列出当前账号空间密钥",
          "当前成员仅列出自己签发的密钥，不返回哈希或完整密钥；负责人可撤销空间内任意密钥。",
        ),
        params: spaceParams,
        response: {
          200: Type.Object({
            items: Type.Array(keySchema, { description: "当前账号密钥列表" }),
          }),
          ...errors,
        },
      },
    },
    async (request) => {
      await requireSpaceAccess(
        database,
        request.appIdentity!.id,
        request.params.spaceId,
      );
      const rows = await database.db
        .select()
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.spaceId, request.params.spaceId),
            eq(apiKeys.createdBy, request.appIdentity!.id),
          ),
        )
        .orderBy(desc(apiKeys.createdAt));
      return { items: rows.map(response) };
    },
  );
  app.post<{ Params: { spaceId: string }; Body: Static<typeof createBody> }>(
    "/api/app/spaces/:spaceId/api-keys",
    {
      config: { ...auth, rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        ...meta(
          "签发空间API密钥",
          "当前空间成员签发自己名下密钥，空间必须启用AI。权限只能缩小当前空间允许范围，完整密钥只在本次响应展示。",
        ),
        params: spaceParams,
        body: createBody,
        response: {
          200: Type.Object({
            key: { ...keySchema, description: "密钥元数据" },
            secret: Type.String({ description: "仅展示一次的完整API密钥" }),
          }),
          ...errors,
          429: errors[400],
        },
      },
    },
    (request) =>
      database.db.transaction(async (tx) => {
        const spaceId = request.params.spaceId,
          userId = request.appIdentity!.id;
        await lockSpace(tx, spaceId);
        await requireSpaceAccess(tx, userId, spaceId);
        const [current] = await tx
          .select()
          .from(spaceAiPolicies)
          .where(eq(spaceAiPolicies.spaceId, spaceId));
        if (!current?.enabled)
          throw new AppError("AI_DISABLED", "请先由空间负责人开启AI访问", 403);
        const scope = request.body.permissions ?? current.permissions;
        if (scope.some((item) => !current.permissions.includes(item)))
          throw new AppError(
            "AI_PERMISSION_DENIED",
            "密钥权限不能超出空间策略",
            403,
          );
        const expiresAt = request.body.expiresAt
          ? new Date(request.body.expiresAt)
          : null;
        if (expiresAt && expiresAt.getTime() <= Date.now())
          throw new AppError(
            "EXPIRES_INVALID",
            "到期时间必须晚于当前时间",
            400,
          );
        const secret = `minmd_${newToken()}`;
        const [created] = await tx
          .insert(apiKeys)
          .values({
            spaceId,
            createdBy: userId,
            name: request.body.name.trim(),
            prefix: secret.slice(0, 14),
            tokenHash: hashToken(secret),
            permissions: scope,
            expiresAt,
          })
          .returning();
        return { key: response(created!), secret };
      }),
  );
  app.delete<{ Params: { keyId: string } }>(
    "/api/app/api-keys/:keyId",
    {
      config: auth,
      schema: {
        ...meta(
          "撤销API密钥",
          "创建者或空间负责人撤销密钥；后续HTTP和MCP调用立即失效，不能重新启用原密钥。",
        ),
        params: Type.Object({ keyId: id }),
        response: {
          200: Type.Object({ ok: Type.Boolean({ description: "撤销成功" }) }),
          ...errors,
        },
      },
    },
    (request) =>
      database.db.transaction(async (tx) => {
        const [key] = await tx
          .select()
          .from(apiKeys)
          .where(eq(apiKeys.id, request.params.keyId));
        if (!key) throw new AppError("NOT_FOUND", "密钥不存在", 404);
        await lockSpace(tx, key.spaceId);
        const space = await requireSpaceAccess(
          tx,
          request.appIdentity!.id,
          key.spaceId,
        );
        if (
          key.createdBy !== request.appIdentity!.id &&
          space.ownerId !== request.appIdentity!.id
        )
          throw new AppError("API_KEY_FORBIDDEN", "只能撤销自己的密钥", 403);
        await tx
          .update(apiKeys)
          .set({ revokedAt: new Date() })
          .where(eq(apiKeys.id, key.id));
        return { ok: true };
      }),
  );
}
