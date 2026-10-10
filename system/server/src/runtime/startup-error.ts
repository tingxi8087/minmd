// Driver errors may contain SQL parameters or credentials. Report known causes
// without printing raw queries, connection strings, or nested error messages.
export function startupErrorMessage(error: unknown): string {
  const hints: Record<string, string> = {
    "28P01":
      "Database authentication failed; check DATABASE_URL username and password in .env.",
    "28000":
      "Database authentication rejected; check the database role and access configuration.",
    "3D000": "Database does not exist; check DATABASE_URL database name.",
    "42P01":
      "数据库缺少必要的表。首次启动或重置数据库后，请先执行 bun run db:sync 初始化表结构，再重新启动服务。",
    "42501":
      "Database permission denied; check the configured database role privileges.",
    ECONNREFUSED:
      "Connection refused; check that PostgreSQL is running and DATABASE_URL points to its port.",
    EADDRINUSE:
      "Server port is already in use; stop the existing process or change PORT.",
  };
  let current = error;
  const visited = new Set<object>();
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const cause = current as { code?: unknown; cause?: unknown };
    if (typeof cause.code === "string" && Object.hasOwn(hints, cause.code)) {
      const prefix =
        cause.code === "42P01" ? "服务启动失败" : "Server startup failed";
      return `${prefix} [${cause.code}]: ${hints[cause.code]}`;
    }
    current = cause.cause;
  }
  if (
    error instanceof Error &&
    (error.message.startsWith("Invalid configuration") ||
      error.message === "Web CMS build missing: run bun run build first")
  )
    return error.message;
  return "Server startup failed; check configuration, port and web-cms build.";
}
