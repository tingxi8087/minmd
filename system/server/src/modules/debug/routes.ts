import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import type { AppConfig } from "../../config/env";
import { AppError } from "../../errors";

const body = Type.Object(
  {
    method: Type.Union(
      ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((v) =>
        Type.Literal(v),
      ),
    ),
    url: Type.String({ maxLength: 8000 }),
    headers: Type.Record(Type.String(), Type.String({ maxLength: 8000 })),
    body: Type.Optional(Type.String({ maxLength: 100000 })),
    auth: Type.Union([
      Type.Literal("current"),
      Type.Literal("none"),
      Type.Literal("custom"),
    ]),
    token: Type.Optional(Type.String({ maxLength: 4096 })),
    confirmWrite: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export async function registerDebugRoutes(
  app: FastifyInstance,
  config: AppConfig,
) {
  const enabled = config.API_DEBUG_ENABLED ?? config.APP_ENV !== "production";
  app.get(
    "/api/openapi.json",
    {
      config: { auth: true, permissions: ["api:read"] },
      schema: { hide: true, response: { 200: Type.Any() } },
    },
    async () => app.swagger(),
  );
  app.get(
    "/api/debug/config",
    {
      config: { auth: true, permissions: ["api:read"] },
      schema: {
        hide: true,
        response: {
          200: Type.Object({
            environment: Type.String(),
            enabled: Type.Boolean(),
          }),
        },
      },
    },
    async () => ({ environment: config.APP_ENV, enabled }),
  );
  app.post<{ Body: Static<typeof body> }>(
    "/api/debug/execute",
    {
      config: { auth: true, permissions: ["api:read", "api:debug"] },
      schema: { hide: true, body, response: { 200: Type.Any() } },
    },
    async (request) => {
      if (!enabled)
        throw new AppError("DEBUG_DISABLED", "当前环境已关闭在线调试", 403);
      const input = request.body;
      // Only registered, documented routes in this process are eligible. No HTTP
      // forwarding, external host, recursive debugger calls or arbitrary URL.
      if (!input.url.startsWith("/api/") || /[\\#\r\n]/.test(input.url))
        throw new AppError(
          "DEBUG_TARGET_INVALID",
          "只允许调试当前后端的接口",
          400,
        );
      const url = new URL(input.url, "http://debug.local");
      const doc = app.swagger() as {
        paths?: Record<string, Record<string, unknown>>;
      };
      const match = Object.entries(doc.paths ?? {}).some(
        ([path, operations]) => {
          const expression = path
            .split(/(\{[^}]+\})/)
            .map((part) =>
              part.startsWith("{")
                ? "[^/]+"
                : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            )
            .join("");
          return (
            !!operations[input.method.toLowerCase()] &&
            new RegExp(`^${expression}$`).test(url.pathname)
          );
        },
      );
      if (
        !match ||
        url.pathname.startsWith("/api/debug/") ||
        url.pathname === "/api/openapi.json"
      )
        throw new AppError(
          "DEBUG_TARGET_INVALID",
          "接口不在当前可调试目录中",
          400,
        );
      if (
        config.APP_ENV === "production" &&
        !["GET", "HEAD", "OPTIONS"].includes(input.method) &&
        !input.confirmWrite
      )
        throw new AppError(
          "DEBUG_CONFIRM_REQUIRED",
          "正式环境写操作需要确认",
          400,
        );
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(input.headers)) {
        const lower = name.toLowerCase();
        if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(lower) || /[\r\n]/.test(value))
          throw new AppError("DEBUG_HEADER_INVALID", "请求头格式不正确", 400);
        if (
          [
            "authorization",
            "cookie",
            "host",
            "origin",
            "content-length",
            "transfer-encoding",
            "connection",
            "x-csrf-token",
          ].includes(lower) ||
          lower.startsWith("x-forwarded-")
        )
          continue;
        headers[lower] = value;
      }
      if (input.auth === "current") {
        for (const name of [
          "authorization",
          "cookie",
          "x-csrf-token",
        ] as const) {
          const value = request.headers[name];
          if (typeof value === "string") headers[name] = value;
        }
        headers.origin = config.PUBLIC_ORIGIN;
      } else if (input.auth === "custom" && input.token)
        headers.authorization = `Bearer ${input.token}`;
      if (input.body !== undefined)
        headers["content-type"] ??= "application/json";
      const start = performance.now();
      const result = await app.inject({
        method: input.method as
          "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS",
        url: url.pathname + url.search,
        headers,
        payload: input.body,
        remoteAddress: request.ip,
      });
      const responseHeaders = Object.fromEntries(
        Object.entries(result.headers).filter(
          ([name]) => name.toLowerCase() !== "set-cookie",
        ),
      );
      return {
        status: result.statusCode,
        duration: Math.round(performance.now() - start),
        headers: responseHeaders,
        body: result.body,
      };
    },
  );
}
