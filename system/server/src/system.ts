import type {
  PermissionCatalog,
  RoleMembership,
} from "./modules/permissions/registry";
import { registerDatabaseRoutes } from "./modules/database/routes";
import { registerDebugRoutes } from "./modules/debug/routes";
import type { FastifyError } from "fastify";
import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import { Type } from "@sinclair/typebox";
import type { AppConfig } from "./config/env";
import type { Database } from "./database/client";
import { AppError } from "./errors";
import { installSecurity } from "./plugins/security";
import { installAuthentication } from "./modules/auth/plugin";
import { installRuntimeLogs } from "./plugins/runtime-logs";
import { registerLogRoutes } from "./modules/logs/routes";
import { registerManagementRoutes } from "./modules/management/routes";
import { registerAuthRoutes } from "./modules/auth/routes";

declare module "fastify" {
  interface FastifyContextConfig {
    auth?: boolean;
    authScope?: "admin" | "app";
    permissions?: string[];
  }
}

export const errorSchema = Type.Object({
  code: Type.String({ description: "稳定错误码", example: "NOT_FOUND" }),
  message: Type.String({
    description: "错误说明",
    example: "资源不存在",
  }),
  requestId: Type.String({
    description: "请求追踪 ID，用于关联运行日志与审计",
    example: "00000000-0000-4000-8000-000000000001",
  }),
});

export const systemPlugin = fp<{
  config: AppConfig;
  database: Database;
  permissions: PermissionCatalog;
  appRoleMembership?: RoleMembership;
}>(
  async (app, { config, database, permissions, appRoleMembership }) => {
    database.pool.on("error", () =>
      app.log.error(
        { code: "DATABASE_POOL_ERROR" },
        "Database idle connection failed",
      ),
    );
    app.addHook("onRequest", async (request, reply) => {
      reply.header("x-request-id", request.id);
    });
    app.setErrorHandler<FastifyError>((error, request, reply) => {
      const pgCode = (error as Error & { cause?: { code?: string } }).cause
        ?.code;
      if (pgCode === "23505")
        error = new AppError(
          "ALREADY_EXISTS",
          "账号、角色名称或角色标识已存在",
          409,
        ) as FastifyError;
      if (pgCode === "23503")
        error = new AppError(
          "REFERENCE_CONFLICT",
          "关联数据不存在或仍被使用",
          409,
        ) as FastifyError;
      const business = error instanceof AppError;
      const status = error.validation
        ? 400
        : business
          ? (error.statusCode ?? 400)
          : error.statusCode && error.statusCode < 500
            ? (error.statusCode ?? 400)
            : 500;
      const code = error.validation
        ? "VALIDATION_ERROR"
        : business
          ? error.code
          : status >= 500
            ? "INTERNAL_ERROR"
            : "REQUEST_ERROR";
      // SQL errors and validation details can contain user input. Never log raw errors.
      request.log[status >= 500 ? "error" : "warn"](
        { code, statusCode: status },
        "Request failed",
      );
      reply.code(status).send({
        code,
        message: business
          ? error.message
          : status >= 500
            ? "服务器内部错误"
            : "请求参数或格式不正确",
        requestId: request.id,
      });
    });
    app.setNotFoundHandler((request, reply) =>
      reply.code(404).send({
        code: "NOT_FOUND",
        message: "接口不存在",
        requestId: request.id,
      }),
    );
    await app.register(swagger, {
      openapi: { info: { title: "MAS Backend", version: "0.1.0" } },
      transform: ({ schema, url, route }) => ({
        url,
        schema: {
          ...schema,
          response: {
            400: {
              ...errorSchema,
              description: "请求参数、格式或业务约束不满足",
            },
            ...(route.config?.auth
              ? {
                  401: { ...errorSchema, description: "未登录或会话已失效" },
                  403: {
                    ...errorSchema,
                    description: "权限不足或身份不符合操作要求",
                  },
                }
              : {}),
            500: {
              ...errorSchema,
              description: "服务器内部错误；使用 requestId 排查日志",
            },
            ...Object.fromEntries(
              Object.entries(
                (schema?.response ?? {}) as Record<string, unknown>,
              ).map(([status, value]) => [
                status,
                value && typeof value === "object"
                  ? {
                      ...value,
                      description:
                        (value as { description?: string }).description ??
                        (
                          {
                            "400": "请求参数或业务约束不满足",
                            "401": "未登录或会话已失效",
                            "403": "权限不足",
                            "404": "目标记录或资源不存在",
                            "429": "请求频率超限",
                            "500": "服务器内部错误",
                            "503": "服务或数据库暂不可用",
                          } as Record<string, string>
                        )[status] ??
                        (status.startsWith("2") ? "请求成功" : "接口响应"),
                    }
                  : value,
              ]),
            ),
          },
          hide: schema?.hide || !url.startsWith("/api/"),
          "x-access": {
            auth: !!route.config?.auth,
            authScope: route.config?.authScope ?? "admin",
            permissions: route.config?.permissions ?? [],
            superAdmin: !!route.config?.superAdmin,
          },
        },
      }),
    });
    app.addHook("onRoute", (route) => {
      if (!route.url.startsWith("/api/")) return;
      if (typeof route.config?.auth !== "boolean" || !route.schema?.response) {
        throw new Error(
          `Route requires explicit auth and response schema: ${route.method} ${route.url}`,
        );
      }
      if (
        ["POST", "PUT", "PATCH"].some((method) =>
          ([] as string[]).concat(route.method).includes(method),
        ) &&
        !route.schema.body
      ) {
        throw new Error(`Route requires body schema: ${route.url}`);
      }
    });
    await installSecurity(app, config);
    await installAuthentication(app, database, config, permissions);
    installRuntimeLogs(app, database, config);
    await registerAuthRoutes(app, database, config);
    await registerManagementRoutes(
      app,
      database,
      config,
      permissions,
      appRoleMembership,
    );
    await registerLogRoutes(app, database);
    const environment = Type.Object({
      environment: Type.String({
        description: "服务端部署环境：development / staging / production",
        example: "development",
      }),
      service: Type.String({ description: "服务名称", example: "mas-backend" }),
    });
    app.get(
      "/api/system/environment",
      {
        config: { auth: false },
        schema: {
          tags: ["系统"],
          summary: "获取运行环境",
          description:
            "返回服务端部署环境和服务名称，无需登录，不暴露连接配置。",
          response: { 200: environment },
        },
      },
      async () => ({ environment: config.APP_ENV, service: "mas-backend" }),
    );
    app.get(
      "/api/health",
      {
        config: { auth: false },
        schema: {
          tags: ["系统"],
          summary: "健康检查",
          description:
            "检查服务和数据库连接是否可用；数据库不可用时返回 503。无需登录。",
          response: {
            200: Type.Object({
              status: Type.Literal("ok", {
                description: "服务健康状态",
                example: "ok",
              }),
              database: Type.Literal("connected", {
                description: "数据库连接状态",
                example: "connected",
              }),
            }),
            503: errorSchema,
          },
        },
      },
      async () => {
        try {
          await database.pool.query("select 1");
        } catch {
          throw new AppError("DATABASE_UNAVAILABLE", "数据库连接不可用", 503);
        }
        return { status: "ok", database: "connected" };
      },
    );
    await registerDebugRoutes(app, config);
    await registerDatabaseRoutes(app, database, config);
  },
  { name: "mas-system" },
);
