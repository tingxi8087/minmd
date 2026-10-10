import { Pool, Query, type PoolClient, type QueryResult } from "pg";

export const limits = { rows: 500, bytes: 1024 * 1024, timeoutMs: 5000 };
export class SqlFailure extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
/** Hide SQL literals/comments before auditing; preserve the operation and identifiers. */
export function sqlSummary(sql: string) {
  // PostgreSQL quoted strings, dollar strings, nested comments and numbers.
  let out = "",
    i = 0;
  while (i < sql.length) {
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
      out += " ";
    } else if (sql.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      }
      out += " ";
    } else if (sql[i] === "'") {
      const escaped =
        i > 0 &&
        /e/i.test(sql[i - 1]!) &&
        (i < 2 || !/[a-z0-9_$]/i.test(sql[i - 2]!));
      i++;
      while (i < sql.length) {
        if (escaped && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i++] === "'") {
          if (sql[i] === "'") {
            i++;
            continue;
          }
          break;
        }
      }
      out += "'?'";
    } else if (
      sql[i] === "$" &&
      /^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/.test(sql.slice(i))
    ) {
      const tag = sql.slice(i).match(/^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/)![0];
      const end = sql.indexOf(tag, i + tag.length);
      i = end < 0 ? sql.length : end + tag.length;
      out += "'?'";
    } else if (sql[i] === '"') {
      // Identifiers can contain secrets too. Audit only a placeholder.
      i++;
      while (i < sql.length) {
        if (sql[i++] === '"') {
          if (sql[i] === '"') {
            i++;
            continue;
          }
          break;
        }
      }
      out += '"identifier"';
    } else if (/\d/.test(sql[i]!)) {
      while (i < sql.length && /[\w.+-]/.test(sql[i]!)) i++;
      out += "?";
    } else {
      out += sql[i++];
    }
  }
  return out.replace(/\s+/g, " ").trim().slice(0, 4000);
}
export function assertStatement(sql: string) {
  const first = sqlSummary(sql)
    .match(/^([a-z]+)/i)?.[1]
    ?.toUpperCase();
  if (
    !first ||
    ![
      "SELECT",
      "WITH",
      "VALUES",
      "TABLE",
      "INSERT",
      "UPDATE",
      "DELETE",
      "MERGE",
      "CREATE",
      "ALTER",
      "DROP",
      "TRUNCATE",
      "COMMENT",
      "GRANT",
      "REVOKE",
      "EXPLAIN",
      "SHOW",
    ].includes(first)
  )
    throw new SqlFailure(
      "SQL_UNSUPPORTED",
      "仅支持查询和事务内的数据/结构语句；不支持事务控制、COPY、SET 或脚本。",
    );
}
export interface SqlResult {
  columns: { name: string; typeId: number }[];
  rows: unknown[][];
  command: string;
  affectedRows: number;
  duration: number;
}

export function createSqlRunner(url: string) {
  const pool = new Pool({
    connectionString: url,
    max: 2,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    application_name: "mas-database-workbench",
    statement_timeout: limits.timeoutMs,
  });
  const control = new Pool({
    connectionString: url,
    max: 2,
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000,
  });
  pool.on("error", () => {});
  control.on("error", () => {});
  async function execute(
    sql: string,
    values: unknown[] = [],
    readOnly = false,
  ): Promise<SqlResult> {
    const start = Date.now();
    const client = await pool.connect();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failure: SqlFailure | undefined;
    let killing: Promise<unknown> | undefined;
    const stop = (error: SqlFailure) => {
      if (failure) return;
      failure = error;
      // Dedicated connection is never reused. Terminate the actual server query,
      // including one that changed its own statement_timeout through a function.
      killing = control
        .query("select pg_terminate_backend($1)", [
          (client as PoolClient & { processID: number }).processID,
        ])
        .catch(() => {});
    };
    client.on("error", () => {});
    try {
      await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
      await client.query("SET LOCAL lock_timeout = '1500ms'");
      await client.query("SET LOCAL standard_conforming_strings = on");
      timer = setTimeout(
        () =>
          stop(
            new SqlFailure(
              "SQL_TIMEOUT",
              "执行超过 5 秒，已终止；事务未提交。",
            ),
          ),
        limits.timeoutMs,
      );
      const rows: unknown[][] = [];
      let bytes = 0;
      const result = await new Promise<QueryResult<unknown[]>>(
        (resolve, reject) => {
          // Extended protocol enforces exactly one statement at the PostgreSQL parser.
          // Event-based row handling avoids pg accumulating unbounded result arrays.
          const query = new Query(
            Object.assign(
              { text: sql, values, rowMode: "array" as const },
              { queryMode: "extended", rows: 100 },
            ),
          );
          query.on("row", (row: unknown[]) => {
            if (failure) return;
            bytes += Buffer.byteLength(JSON.stringify(row));
            if (rows.length >= limits.rows || bytes > limits.bytes) {
              stop(
                new SqlFailure(
                  "SQL_RESULT_LIMIT",
                  "结果超过 500 行或 1 MiB，已终止并回滚；请缩小查询范围或使用 LIMIT。",
                ),
              );
            } else rows.push(row);
          });
          query.on("error", reject);
          query.on("end", resolve);
          client.query(query);
        },
      );
      if (failure) throw failure;
      await client.query("COMMIT");
      return {
        columns: result.fields.map((f) => ({
          name: f.name,
          typeId: f.dataTypeID,
        })),
        rows,
        command: result.command,
        affectedRows: result.rowCount ?? 0,
        duration: Date.now() - start,
      };
    } catch (error) {
      // Disconnect in finally also rolls back. Do not include PostgreSQL detail
      // (which can contain passwords/literals) in routine logs or audit records.
      if (failure) throw failure;
      const e = error as { code?: string; position?: string };
      const messages: Record<string, string> = {
        "57014": "执行超时，已由数据库取消。",
        "42601": "SQL 语法错误或包含多条语句。",
        "42P01": "数据表不存在。",
        "42703": "字段不存在。",
        "23505": "违反唯一约束。",
        "23503": "违反外键约束。",
        "42501": "数据库连接账号没有执行权限。",
        "55P03": "等待锁超时。",
        "25006": "只读浏览不允许修改数据库。",
      };
      throw new SqlFailure(
        e.code ?? "SQL_FAILED",
        (messages[e.code ?? ""] ?? "SQL 执行失败，事务未提交。") +
          (e.position ? ` 位置：${e.position}` : ""),
      );
    } finally {
      if (timer) clearTimeout(timer);
      if (killing) await killing;
      client.release(true);
    }
  }
  return { execute, close: () => Promise.all([pool.end(), control.end()]) };
}
