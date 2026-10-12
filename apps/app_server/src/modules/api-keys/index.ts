import type { AppConfig } from "../../../../../system/server/src/config/env";
import {
  writeAudit,
  type Transaction,
} from "../../../../../system/server/src/modules/audit/service";
import { encryptSecret, decryptSecret } from "./secret";
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { and, eq, desc, isNull } from "drizzle-orm";
import type { Database } from "../../../../../system/server/src/database/client";
import { AppError } from "../../../../../system/server/src/errors";
import {
  newToken,
  hashToken,
} from "../../../../../system/server/src/modules/auth/password";
import { apiKeys, aiPermissions } from "../../database/schema/ai";
import { lockSpace, requireSpaceAccess } from "../spaces/service";
import { id, errors, spaceParams } from "../spaces/schemas";

const permission = Type.Union(
  aiPermissions.map((value) => Type.Literal(value)),
  { description: "读取、创建、编辑、整理、删除恢复或上传" },
);
const permissions = Type.Array(permission, {
  uniqueItems: true,
  minItems: 1,
  maxItems: 6,
  description: "显式操作权限集合",
});
const keySchema = Type.Object({
  id,
  spaceId: id,
  createdBy: id,
  name: Type.String({ description: "密钥名称" }),
  prefix: Type.String({ description: "用于识别的密钥前缀" }),
  permissions,
  canReveal: Type.Boolean({ description: "是否支持查看完整密钥" }),
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
    canReveal: key.encryptedSecret !== null,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  };
}
export async function registerApiKeys(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
  encryptionKey?: string,
) {
  const auth = { auth: true, authScope: "app" as const };
  const meta = (summary: string, description: string) => ({
    tags: ["空间AI与密钥"],
    summary,
    description,
  });
  const params = Type.Object({ keyId: id });
  const secretSchema = Type.Object({
    secret: Type.String({ description: "完整API密钥，仅创建者可查看" }),
  });
  const failures = { ...errors, 503: errors[400] };
  const expiry = (value?: string | null) => {
    const result = value ? new Date(value) : null;
    if (result && result.getTime() <= Date.now())
      throw new AppError("EXPIRES_INVALID", "到期时间必须晚于当前时间", 400);
    return result;
  };
  const managedKey = async (tx: Transaction, userId: string, keyId: string) => {
    const [initial] = await tx
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, keyId));
    if (!initial) throw new AppError("NOT_FOUND", "密钥不存在", 404);
    await lockSpace(tx, initial.spaceId);
    const space = await requireSpaceAccess(tx, userId, initial.spaceId);
    const [key] = await tx
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, keyId))
      .for("update");
    if (!key || key.revokedAt)
      throw new AppError("NOT_FOUND", "密钥不存在", 404);
    if (key.createdBy !== userId && space.ownerId !== userId)
      throw new AppError("API_KEY_FORBIDDEN", "只能管理自己的密钥", 403);
    return key;
  };
  app.get<{ Params: { spaceId: string } }>(
    "/api/app/spaces/:spaceId/api-keys",
    {
      config: auth,
      schema: {
        ...meta(
          "列出空间API密钥",
          "成员仅列出自己的密钥，空间负责人可列出全部密钥；不返回完整密钥、密文或哈希。",
        ),
        params: spaceParams,
        response: {
          200: Type.Object({
            items: Type.Array(keySchema, { description: "可管理的密钥列表" }),
          }),
          ...errors,
        },
      },
    },
    async (request) => {
      const userId = request.appIdentity!.id;
      const space = await requireSpaceAccess(
        database,
        userId,
        request.params.spaceId,
      );
      const rows = await database.db
        .select()
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.spaceId, space.id),
            isNull(apiKeys.revokedAt),
            ...(space.ownerId === userId
              ? []
              : [eq(apiKeys.createdBy, userId)]),
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
      onSend: async (_request, reply, payload) => {
        reply.header("Cache-Control", "no-store");
        return payload;
      },
      schema: {
        ...meta(
          "创建空间API密钥",
          "当前空间成员创建自己的密钥，默认只读。权限仅由密钥配置，实际操作仍受创建者文件权限限制。",
        ),
        params: spaceParams,
        body: createBody,
        response: {
          200: Type.Object({
            key: { ...keySchema, description: "密钥元数据" },
            secret: Type.String({ description: "完整API密钥" }),
          }),
          ...failures,
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
        const keyId = crypto.randomUUID(),
          secret = `minmd_${newToken()}`;
        const [key] = await tx
          .insert(apiKeys)
          .values({
            id: keyId,
            spaceId,
            createdBy: userId,
            name: request.body.name.trim(),
            prefix: secret.slice(0, 14),
            tokenHash: hashToken(secret),
            encryptedSecret: encryptSecret(
              secret,
              `${keyId}:${spaceId}`,
              encryptionKey,
            ),
            permissions: request.body.permissions ?? ["read"],
            expiresAt: expiry(request.body.expiresAt),
          })
          .returning();
        await writeAudit(tx, request, config.APP_ENV, {
          action: "ai-key.create",
          targetType: "api-key",
          targetId: keyId,
          after: {
            actorUserId: userId,
            name: key!.name,
            permissions: key!.permissions,
          },
          result: "success",
        });
        return { key: response(key!), secret };
      }),
  );
  app.post<{ Params: { keyId: string }; Body: Record<string, never> }>(
    "/api/app/api-keys/:keyId/reveal",
    {
      config: { ...auth, rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        ...meta(
          "查看完整API密钥",
          "仅密钥创建者可查看。旧版仅存哈希的密钥无法恢复；空间负责人不能查看他人的完整密钥。",
        ),
        params,
        body: Type.Object({}, { additionalProperties: false }),
        response: { 200: secretSchema, ...failures, 429: errors[400] },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return database.db.transaction(async (tx) => {
        const key = await managedKey(
          tx,
          request.appIdentity!.id,
          request.params.keyId,
        );
        if (key.createdBy !== request.appIdentity!.id)
          throw new AppError(
            "API_KEY_FORBIDDEN",
            "只能查看自己的完整密钥",
            403,
          );
        if (!key.encryptedSecret)
          throw new AppError(
            "KEY_SECRET_UNAVAILABLE",
            "旧密钥无法查看完整值，请重新创建",
            409,
          );
        const secret = decryptSecret(
          key.encryptedSecret,
          `${key.id}:${key.spaceId}`,
          encryptionKey,
        );
        await writeAudit(tx, request, config.APP_ENV, {
          action: "ai-key.reveal",
          targetType: "api-key",
          targetId: key.id,
          after: { actorUserId: request.appIdentity!.id },
          result: "success",
        });
        return { secret };
      });
    },
  );
  app.patch<{ Params: { keyId: string }; Body: Static<typeof createBody> }>(
    "/api/app/api-keys/:keyId",
    {
      config: auth,
      schema: {
        ...meta(
          "修改API密钥",
          "创建者或空间负责人修改名称、权限和有效期，密钥字符串保持不变，后续调用实时验证新权限。",
        ),
        params,
        body: createBody,
        response: { 200: keySchema, ...errors },
      },
    },
    (request) =>
      database.db.transaction(async (tx) => {
        const key = await managedKey(
          tx,
          request.appIdentity!.id,
          request.params.keyId,
        );
        const [updated] = await tx
          .update(apiKeys)
          .set({
            name: request.body.name.trim(),
            permissions: request.body.permissions ?? key.permissions,
            expiresAt:
              request.body.expiresAt === undefined
                ? key.expiresAt
                : expiry(request.body.expiresAt),
          })
          .where(eq(apiKeys.id, key.id))
          .returning();
        await writeAudit(tx, request, config.APP_ENV, {
          action: "ai-key.update",
          targetType: "api-key",
          targetId: key.id,
          after: {
            actorUserId: request.appIdentity!.id,
            name: updated!.name,
            permissions: updated!.permissions,
          },
          result: "success",
        });
        return response(updated!);
      }),
  );
  app.delete<{ Params: { keyId: string } }>(
    "/api/app/api-keys/:keyId",
    {
      config: auth,
      schema: {
        ...meta(
          "删除API密钥",
          "创建者或空间负责人删除密钥及其幂等记录，后续HTTP和MCP调用失效，列表不保留已删除条目。",
        ),
        params,
        response: {
          200: Type.Object({ ok: Type.Boolean({ description: "删除成功" }) }),
          ...errors,
        },
      },
    },
    (request) =>
      database.db.transaction(async (tx) => {
        const key = await managedKey(
          tx,
          request.appIdentity!.id,
          request.params.keyId,
        );
        await tx.delete(apiKeys).where(eq(apiKeys.id, key.id));
        await writeAudit(tx, request, config.APP_ENV, {
          action: "ai-key.delete",
          targetType: "api-key",
          targetId: key.id,
          before: { actorUserId: request.appIdentity!.id, name: key.name },
          result: "success",
        });
        return { ok: true };
      }),
  );
}
