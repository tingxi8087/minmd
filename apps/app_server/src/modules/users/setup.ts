import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import type { Database } from "../../../../../system/server/src/database/client";
import type { AppConfig } from "../../../../../system/server/src/config/env";
import { errorSchema } from "../../../../../system/server/src/system";
import { AppError } from "../../../../../system/server/src/errors";
import {
  hashValidatedPassword,
  hashToken,
  newToken,
} from "../../../../../system/server/src/modules/auth/password";
import { writeAudit } from "../../../../../system/server/src/modules/audit/service";
import type { MinmdAuthConfig } from "../../../../../config/minmd";
import { appUsers, appUserSessions } from "../../database/schema/users";
import { account, password, profile, uuid } from "./schemas";
import { fields } from "../spaces/schemas";
import {
  lockAccountCreation,
  needsSetup,
  completeSetup,
  createDefaultSpace,
} from "./provisioning";
import { sessionFields, respondSession } from "./session";
const body = Type.Object(
  {
    account,
    password,
    nickname: Type.Optional(profile.nickname),
    spaceName: fields.name,
    description: Type.Optional(fields.description),
  },
  { additionalProperties: false },
);
export async function registerSetup(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
  business: MinmdAuthConfig,
) {
  app.get(
    "/api/app/auth/setup",
    {
      config: { auth: false },
      schema: {
        tags: ["首次使用"],
        summary: "查询前台初始化状态",
        description:
          "仅返回是否需要首次初始化，不返回账号数量或资料。已有账号或完成标记时不开放初始化。",
        response: {
          200: Type.Object({
            needsSetup: Type.Boolean({ description: "是否需要首次初始化" }),
          }),
        },
      },
    },
    async (_request, reply) => {
      reply.header("cache-control", "no-store");
      return { needsSetup: await needsSetup(database.db) };
    },
  );
  app.post<{ Body: Static<typeof body> }>(
    "/api/app/auth/setup",
    {
      config: { auth: false, rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["首次使用"],
        summary: "初始化首个前台账号与空间",
        description:
          "仅无前台账号且未完成初始化时允许。不受公开注册开关影响，Cookie 模式须为允许来源。原子创建账号、所有者空间、引导文档与登录会话，并永久关闭匿名初始化入口。",
        body,
        response: {
          200: Type.Object({
            ...sessionFields,
            spaceId: uuid,
            documentId: uuid,
          }),
          400: errorSchema,
          403: errorSchema,
          409: errorSchema,
          429: errorSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      // 匿名首次写入还没有 CSRF 凭证，严格限制来源，后续写入沿用正常会话 CSRF。
      if (
        config.AUTH_TRANSPORT === "cookie" &&
        !business.allowedOrigins.includes(request.headers.origin ?? "")
      )
        throw new AppError(
          "CSRF_INVALID",
          "请求来源无效，请从正式前台入口访问",
          403,
        );
      const passwordHash = await hashValidatedPassword(request.body.password);
      const token = newToken();
      const expiresAt = new Date(
        Date.now() + config.AUTH_SESSION_HOURS * 3600000,
      );
      const destination = await database.db.transaction(async (tx) => {
        await lockAccountCreation(tx);
        if (!(await needsSetup(tx)))
          throw new AppError(
            "SETUP_COMPLETED",
            "初始化已完成，请使用已有账号登录",
            409,
          );
        const account = request.body.account.toLowerCase();
        const [user] = await tx
          .insert(appUsers)
          .values({
            account,
            passwordHash,
            nickname: request.body.nickname?.trim() || account,
            lastLoginAt: new Date(),
          })
          .returning();
        const destination = await createDefaultSpace(tx, user!, {
          name: request.body.spaceName,
          description: request.body.description,
        });
        await tx.insert(appUserSessions).values({
          userId: user!.id,
          tokenHash: hashToken(token),
          transport: config.AUTH_TRANSPORT,
          expiresAt,
        });
        await completeSetup(tx);
        await writeAudit(tx, request, config.APP_ENV, {
          action: "app.setup",
          targetType: "app-user",
          targetId: user!.id,
          result: "success",
          after: { account, ...destination },
        });
        return destination;
      });
      return {
        ...respondSession(reply, config, token, expiresAt),
        ...destination,
      };
    },
  );
}
