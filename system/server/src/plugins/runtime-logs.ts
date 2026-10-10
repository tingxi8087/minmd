import type { FastifyInstance } from "fastify";
import { lt, or } from "drizzle-orm";
import type { Database } from "../database/client";
import type { AppConfig } from "../config/env";
import { auditLogs, runtimeLogs, sessions } from "../database/schema/system";
/** Bounded asynchronous queue; safe metadata only. Standard output remains primary fallback. */
export function installRuntimeLogs(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
) {
  let queue: (typeof runtimeLogs.$inferInsert)[] = [];
  let flushing: Promise<void> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let cleanup: ReturnType<typeof setInterval> | undefined;
  const flush = async () => {
    if (flushing) return flushing;
    if (!queue.length) return;
    const batch = queue.splice(0, 200);
    flushing = (async () => {
      try {
        await database.db.insert(runtimeLogs).values(batch);
      } catch {
        app.log.error(
          { code: "LOG_WRITE_FAILED", dropped: batch.length },
          "Runtime log batch dropped; consult standard output",
        );
      } finally {
        flushing = undefined;
      }
    })();
    return flushing;
  };
  const prune = async () => {
    const now = Date.now();
    try {
      await database.db
        .delete(runtimeLogs)
        .where(
          lt(
            runtimeLogs.createdAt,
            new Date(now - config.LOG_RETENTION_DAYS * 86400000),
          ),
        );
      await database.db
        .delete(auditLogs)
        .where(
          lt(
            auditLogs.createdAt,
            new Date(now - config.AUDIT_RETENTION_DAYS * 86400000),
          ),
        );
      await database.db
        .delete(sessions)
        .where(
          or(
            lt(sessions.expiresAt, new Date(now - 86400000)),
            lt(sessions.revokedAt, new Date(now - 86400000)),
          ),
        );
    } catch {
      app.log.error({ code: "LOG_CLEANUP_FAILED" }, "Scheduled cleanup failed");
    }
  };
  app.addHook("onReady", async () => {
    interval = setInterval(() => void flush(), 1000);
    interval.unref();
    cleanup = setInterval(() => void prune(), 3600000);
    cleanup.unref();
    await prune();
  });
  app.addHook("onResponse", async (request, reply) => {
    // Route templates remove identifiers, arbitrary path/query input and credentials.
    const routePath = request.routeOptions.url ?? "<unmatched>";
    if (!routePath.startsWith("/api/")) return;
    if (queue.length >= 1000) {
      app.log.warn(
        { code: "LOG_QUEUE_FULL" },
        "Runtime log dropped; consult standard output",
      );
      return;
    }
    queue.push({
      level:
        reply.statusCode >= 500
          ? "ERROR"
          : reply.statusCode >= 400
            ? "WARN"
            : "INFO",
      message: reply.statusCode >= 400 ? "Request failed" : "Request completed",
      requestId: request.id,
      method: request.method,
      path: routePath.slice(0, 500),
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
      environment: config.APP_ENV,
    });
  });
  app.addHook("onClose", async () => {
    clearInterval(interval);
    clearInterval(cleanup);
    if (flushing) await flushing;
    while (queue.length) await flush();
  });
}
