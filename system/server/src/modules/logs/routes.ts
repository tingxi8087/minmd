import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { and, eq, gte, lte, ilike, count, desc } from "drizzle-orm";
import type { Database } from "../../database/client";
import { auditLogs, runtimeLogs } from "../../database/schema/system";
import { AppError } from "../../errors";
const querySchema = Type.Object(
  {
    page: Type.Optional(
      Type.Integer({ minimum: 1, description: "页码，从 1 开始", example: 1 }),
    ),
    pageSize: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        description: "每页条数，最多 100",
        example: 20,
      }),
    ),
    requestId: Type.Optional(
      Type.String({
        maxLength: 100,
        description: "请求追踪 ID，用于关联运行日志与审计",
        example: "00000000-0000-4000-8000-000000000001",
      }),
    ),
    level: Type.Optional(
      Type.Union(
        [Type.Literal("INFO"), Type.Literal("WARN"), Type.Literal("ERROR")],
        { description: "日志级别：INFO / WARN / ERROR", example: "INFO" },
      ),
    ),
    path: Type.Optional(
      Type.String({
        maxLength: 200,
        description: "接口路径",
        example: "/api/health",
      }),
    ),
    actor: Type.Optional(
      Type.String({
        maxLength: 64,
        description: "操作账号，按账号筛选",
        example: "demo_admin",
      }),
    ),
    action: Type.Optional(
      Type.String({
        maxLength: 100,
        description: "操作标识",
        example: "auth.login",
      }),
    ),
    result: Type.Optional(
      Type.String({
        maxLength: 16,
        description: "操作结果：success / denied / failure",
        example: "success",
      }),
    ),
    from: Type.Optional(
      Type.String({
        format: "date-time",
        description: "起始时间（包含，ISO 8601）",
        example: "2026-09-01T00:00:00.000Z",
      }),
    ),
    to: Type.Optional(
      Type.String({
        format: "date-time",
        description: "结束时间（包含，ISO 8601）",
        example: "2026-10-01T00:00:00.000Z",
      }),
    ),
  },
  { additionalProperties: false },
);
type Query = {
  page?: number;
  pageSize?: number;
  requestId?: string;
  level?: string;
  path?: string;
  actor?: string;
  action?: string;
  result?: string;
  from?: string;
  to?: string;
};
const nullableString = Type.Union([Type.String(), Type.Null()]);
const runtimeSchema = Type.Object({
  id: Type.String({
    description: "记录 ID；操作已有记录时请替换为实际 ID",
    example: "00000000-0000-4000-8000-000000000001",
  }),
  level: Type.String({
    description: "日志级别：INFO / WARN / ERROR",
    example: "INFO",
  }),
  message: Type.String({
    description: "提示或日志内容",
    example: "请求已完成",
  }),
  requestId: Type.String({
    description: "请求追踪 ID，用于关联运行日志与审计",
    example: "00000000-0000-4000-8000-000000000001",
  }),
  method: Type.String({ description: "HTTP 请求方法", example: "GET" }),
  path: Type.String({ description: "接口路径", example: "/api/health" }),
  statusCode: Type.Number({ description: "HTTP 响应状态码", example: 200 }),
  durationMs: Type.Number({ description: "请求耗时，单位毫秒", example: 12 }),
  environment: Type.String({
    description: "服务端部署环境：development / staging / production",
    example: "development",
  }),
  createdAt: Type.String({
    description: "创建时间（ISO 8601）",
    example: "2026-09-19T00:00:00.000Z",
  }),
});
const auditSchema = Type.Object({
  id: Type.String({
    description: "记录 ID；操作已有记录时请替换为实际 ID",
    example: "00000000-0000-4000-8000-000000000001",
  }),
  actorId: { ...nullableString, description: "操作人 ID；未登录为 null" },
  actorAccount: {
    ...nullableString,
    description: "操作人登录账号；未登录为 null",
  },
  action: Type.String({ description: "操作标识", example: "auth.login" }),
  targetType: Type.String({ description: "操作对象类型", example: "admin" }),
  targetId: {
    ...nullableString,
    description: "操作对象 ID；没有对象时为 null",
  },
  result: Type.String({
    description: "操作结果：success / denied / failure",
    example: "success",
  }),
  before: Type.Union(
    [Type.Record(Type.String(), Type.Unknown()), Type.Null()],
    { description: "操作前的脱敏快照；无快照时为 null" },
  ),
  after: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()], {
    description: "操作后的脱敏快照；无快照时为 null",
  }),
  requestId: {
    ...nullableString,
    description: "请求追踪 ID，用于关联运行日志与审计",
    example: "00000000-0000-4000-8000-000000000001",
  },
  environment: Type.String({
    description: "服务端部署环境：development / staging / production",
    example: "development",
  }),
  createdAt: Type.String({
    description: "创建时间（ISO 8601）",
    example: "2026-09-19T00:00:00.000Z",
  }),
});
export async function registerLogRoutes(
  app: FastifyInstance,
  database: Database,
) {
  app.get<{ Querystring: Query }>(
    "/api/admin/logs",
    {
      config: { auth: true, permissions: ["log:read"] },
      schema: {
        tags: ["日志与审计"],
        summary: "查询运行日志",
        description:
          "按请求 ID、级别、路径和时间范围分页查询运行日志；不会返回请求体或认证凭证。",
        querystring: querySchema,
        response: {
          200: Type.Object({
            items: Type.Array(runtimeSchema, { description: "当前页记录列表" }),
            total: Type.Number({
              description: "符合条件的记录总数",
              example: 1,
            }),
            page: Type.Number({ description: "页码，从 1 开始", example: 1 }),
            pageSize: Type.Number({
              description: "每页条数，最多 100",
              example: 20,
            }),
          }),
        },
      },
    },
    async (request) => {
      const q = request.query;
      if (
        q.from &&
        q.to &&
        new Date(q.from).getTime() > new Date(q.to).getTime()
      )
        throw new AppError("INVALID_RANGE", "开始时间不能晚于结束时间");
      const where = and(
        q.requestId ? eq(runtimeLogs.requestId, q.requestId) : undefined,
        q.level ? eq(runtimeLogs.level, q.level) : undefined,
        q.path ? ilike(runtimeLogs.path, `%${q.path}%`) : undefined,
        q.from ? gte(runtimeLogs.createdAt, new Date(q.from)) : undefined,
        q.to ? lte(runtimeLogs.createdAt, new Date(q.to)) : undefined,
      );
      const [total] = await database.db
        .select({ value: count() })
        .from(runtimeLogs)
        .where(where);
      const pageSize = q.pageSize ?? 20;
      const currentPage = Math.max(
        1,
        Math.min(q.page ?? 1, Math.ceil(total!.value / pageSize) || 1),
      );
      const rows = await database.db
        .select()
        .from(runtimeLogs)
        .where(where)
        .orderBy(desc(runtimeLogs.createdAt), runtimeLogs.id)
        .limit(q.pageSize ?? 20)
        .offset((currentPage - 1) * pageSize);
      return {
        items: rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
        })),
        total: total!.value,
        page: currentPage,
        pageSize,
      };
    },
  );
  app.get<{ Querystring: Query }>(
    "/api/admin/audit",
    {
      config: { auth: true, permissions: ["audit:read"] },
      schema: {
        tags: ["日志与审计"],
        summary: "查询操作审计",
        description:
          "按操作人、动作、结果和时间范围分页查询审计记录；快照仅包含脱敏信息。",
        querystring: querySchema,
        response: {
          200: Type.Object({
            items: Type.Array(auditSchema, { description: "当前页记录列表" }),
            total: Type.Number({
              description: "符合条件的记录总数",
              example: 1,
            }),
            page: Type.Number({ description: "页码，从 1 开始", example: 1 }),
            pageSize: Type.Number({
              description: "每页条数，最多 100",
              example: 20,
            }),
          }),
        },
      },
    },
    async (request) => {
      const q = request.query;
      if (
        q.from &&
        q.to &&
        new Date(q.from).getTime() > new Date(q.to).getTime()
      )
        throw new AppError("INVALID_RANGE", "开始时间不能晚于结束时间");
      const where = and(
        q.requestId ? eq(auditLogs.requestId, q.requestId) : undefined,
        q.actor ? ilike(auditLogs.actorAccount, `%${q.actor}%`) : undefined,
        q.action ? ilike(auditLogs.action, `%${q.action}%`) : undefined,
        q.result ? eq(auditLogs.result, q.result) : undefined,
        q.from ? gte(auditLogs.createdAt, new Date(q.from)) : undefined,
        q.to ? lte(auditLogs.createdAt, new Date(q.to)) : undefined,
      );
      const [total] = await database.db
        .select({ value: count() })
        .from(auditLogs)
        .where(where);
      const pageSize = q.pageSize ?? 20;
      const currentPage = Math.max(
        1,
        Math.min(q.page ?? 1, Math.ceil(total!.value / pageSize) || 1),
      );
      const rows = await database.db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.createdAt), auditLogs.id)
        .limit(q.pageSize ?? 20)
        .offset((currentPage - 1) * pageSize);
      return {
        items: rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
        })),
        total: total!.value,
        page: currentPage,
        pageSize,
      };
    },
  );
}
