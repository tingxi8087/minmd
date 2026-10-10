import {
  databaseConfigSchema,
  tableListSchema,
  tableDataSchema,
  sqlResultSchema,
} from "./schemas";
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { createHash } from "node:crypto";
import type { AppConfig } from "../../config/env";
import type { Database } from "../../database/client";
import { writeAudit } from "../audit/service";
import {
  createSqlRunner,
  limits,
  assertStatement,
  sqlSummary,
  SqlFailure,
} from "./runner";

const tableQuery = Type.Object(
  {
    schema: Type.String({
      maxLength: 63,
      description: "PostgreSQL schema 名称",
      example: "public",
    }),
    table: Type.String({
      maxLength: 63,
      description: "数据表名称",
      example: "app_users",
    }),
    page: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100000,
        default: 1,
        description: "页码，从 1 开始",
        example: 1,
      }),
    ),
    pageSize: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        default: 20,
        description: "每页条数，最多 100",
        example: 20,
      }),
    ),
  },
  { additionalProperties: false },
);
const executeBody = Type.Object(
  {
    sql: Type.String({
      minLength: 1,
      maxLength: 100000,
      description: "要执行的单条 SQL；查询或事务内写入语句",
      example: "SELECT 1 AS value;",
    }),
    confirmEnvironment: Type.Optional(
      Type.String({
        maxLength: 30,
        description: "正式环境执行时必须明确传 production；其他环境无需填写",
      }),
    ),
  },
  { additionalProperties: false },
);
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
export async function registerDatabaseRoutes(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
) {
  const runner = createSqlRunner(config.DATABASE_URL);
  app.addHook("onClose", async () => {
    await runner.close();
  });
  const access = { auth: true, superAdmin: true };
  app.get(
    "/api/database/config",
    {
      config: access,
      schema: {
        tags: ["数据库"],
        summary: "数据库工作台配置",
        description:
          "仅超管可用。返回当前环境、数据库名称以及查询资源限制，不返回连接地址或密码。",
        response: { 200: databaseConfigSchema },
      },
    },
    async () => ({
      environment: config.APP_ENV,
      database: decodeURIComponent(
        new URL(config.DATABASE_URL).pathname.slice(1),
      ),
      limits,
    }),
  );
  app.get(
    "/api/database/tables",
    {
      config: access,
      schema: {
        tags: ["数据库"],
        summary: "查看数据库表目录",
        description:
          "仅超管可用。列出当前数据库最多 500 张用户表及注释，排除 PostgreSQL 系统目录。",
        response: { 200: tableListSchema },
      },
    },
    async () => {
      const result = await runner.execute(
        `SELECT n.nspname AS schema, c.relname AS name, coalesce(obj_description(c.oid), '') AS comment
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
      ORDER BY n.nspname,c.relname LIMIT 500`,
        [],
        true,
      );
      return {
        tables: result.rows.map(([schema, name, comment]) => ({
          schema,
          name,
          comment,
        })),
      };
    },
  );
  app.get<{ Querystring: Static<typeof tableQuery> }>(
    "/api/database/table",
    {
      config: access,
      schema: {
        tags: ["数据库"],
        summary: "查看表结构与分页数据",
        description:
          "仅超管可用。按 schema 和表名查看字段结构及分页数据；密码、令牌、密钥命名字段默认隐藏。",
        querystring: tableQuery,
        response: { 200: tableDataSchema },
      },
    },
    async (request, reply) => {
      const { schema, table, page = 1, pageSize = 20 } = request.query;
      try {
        const metadata = await runner.execute(
          `SELECT a.attname, format_type(a.atttypid,a.atttypmod), NOT a.attnotnull, coalesce(col_description(c.oid,a.attnum),''),
        EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.oid AND i.indisprimary AND a.attnum=ANY(i.indkey))
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=$1 AND c.relname=$2 AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
        AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%' ORDER BY a.attnum`,
          [schema, table],
          true,
        );
        if (!metadata.rows.length)
          return reply.code(404).send({
            code: "TABLE_NOT_FOUND",
            message: "表不存在或不在可浏览目录中",
          });
        const columns = metadata.rows.map(
          ([name, type, nullable, comment, primary]) => ({
            name: String(name),
            type,
            nullable,
            comment,
            primary,
          }),
        );
        const target = `${quote(schema)}.${quote(table)}`;
        const count = await runner.execute(
          `SELECT count(*)::text FROM ${target}`,
          [],
          true,
        );
        const total = Number(count.rows[0]?.[0] ?? 0);
        const currentPage = Math.min(
          page,
          Math.max(1, Math.ceil(total / pageSize)),
        );
        const primary = columns
          .filter((c) => c.primary)
          .map((c) => quote(c.name));
        const fields = columns
          .map((c) =>
            /password|token|secret/i.test(c.name)
              ? `'[已隐藏]' AS ${quote(c.name)}`
              : quote(c.name),
          )
          .join(",");
        const data = await runner.execute(
          `SELECT ${fields} FROM ${target} ORDER BY ${primary.length ? primary.join(",") : "ctid"} LIMIT $1 OFFSET $2`,
          [pageSize, (currentPage - 1) * pageSize],
          true,
        );
        return { columns, rows: data.rows, total, page: currentPage, pageSize };
      } catch (error) {
        const e = error as SqlFailure;
        return reply
          .code(400)
          .send({ code: e.code ?? "DATABASE_ERROR", message: e.message });
      }
    },
  );
  app.post<{ Body: Static<typeof executeBody> }>(
    "/api/database/execute",
    {
      config: access,
      schema: {
        tags: ["数据库"],
        summary: "执行单条 SQL",
        description:
          "仅超管可用。执行单条事务内语句，最多返回 500 行或 1 MiB，5 秒超时；失败或超限回滚。正式环境必须确认，执行过程记录脱敏审计。",
        body: executeBody,
        response: { 200: sqlResultSchema },
      },
    },
    async (request, reply) => {
      const { sql, confirmEnvironment } = request.body;
      const executionId = crypto.randomUUID();
      const snapshot = {
        executionId,
        sql: sqlSummary(sql),
        sha256: createHash("sha256").update(sql).digest("hex"),
      };
      // Persist intent before executing. If the audit store is unavailable, fail closed.
      await writeAudit(database.db, request, config.APP_ENV, {
        action: "database.sql.started",
        targetType: "database",
        targetId: executionId,
        after: snapshot,
        result: "success",
      });
      let result;
      const start = Date.now();
      try {
        if (
          config.APP_ENV === "production" &&
          confirmEnvironment !== "production"
        )
          throw new SqlFailure(
            "ENVIRONMENT_CONFIRMATION",
            "请确认在 production 正式环境执行 SQL。",
          );
        assertStatement(sql);
        result = await runner.execute(sql);
      } catch (error) {
        const e = error as SqlFailure;
        await writeAudit(database.db, request, config.APP_ENV, {
          action: "database.sql.failed",
          targetType: "database",
          targetId: executionId,
          after: {
            ...snapshot,
            code: e.code ?? "SQL_FAILED",
            duration: Date.now() - start,
          },
          result: "failure",
        });
        return reply.code(400).send({
          code: e.code ?? "SQL_FAILED",
          message: e instanceof SqlFailure ? e.message : "数据库连接失败。",
          requestId: request.id,
        });
      }
      let auditWarning: string | undefined;
      try {
        await writeAudit(database.db, request, config.APP_ENV, {
          action: "database.sql.completed",
          targetType: "database",
          targetId: executionId,
          after: {
            ...snapshot,
            command: result.command,
            affectedRows: result.affectedRows,
            duration: result.duration,
          },
          result: "success",
        });
      } catch {
        // SQL may have changed the audit table. Never tell the user to retry an
        // already committed write just because recording its outcome failed.
        auditWarning = "SQL 已提交，但结果审计写入失败；请勿重复执行。";
        app.log.error(
          { executionId, code: "SQL_AUDIT_FAILED" },
          "SQL committed; outcome audit unavailable",
        );
      }
      return { ...result, executionId, auditWarning };
    },
  );
}
