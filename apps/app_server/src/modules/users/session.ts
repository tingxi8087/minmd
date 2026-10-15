import type { FastifyReply } from "fastify";
import { Type } from "@sinclair/typebox";
import type { AppConfig } from "../../../../../system/server/src/config/env";
import { hashToken } from "../../../../../system/server/src/modules/auth/password";
import { csrfFor } from "../../../../../system/server/src/modules/auth/plugin";
import { appSessionCookie } from "./auth";
export const sessionFields = {
  token: Type.Optional(Type.String({ description: "Bearer 令牌" })),
  csrfToken: Type.Optional(
    Type.String({ description: "Cookie 写请求 CSRF 凭证" }),
  ),
  expiresAt: Type.String({ description: "会话过期时间" }),
};
export function respondSession(
  reply: FastifyReply,
  config: AppConfig,
  token: string,
  expiresAt: Date,
) {
  reply.header("cache-control", "no-store");
  if (config.AUTH_TRANSPORT === "cookie") {
    reply.setCookie(appSessionCookie, token, {
      httpOnly: true,
      secure: config.APP_ENV === "production" && !config.HTTP_IP_DIRECT,
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
}
