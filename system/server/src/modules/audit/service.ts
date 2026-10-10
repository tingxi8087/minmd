import type { FastifyRequest } from "fastify";
import type { Database } from "../../database/client";
import { auditLogs } from "../../database/schema/system";
/** Only explicit, non-secret domain snapshots may enter audit events. */
export type AuditEvent = Pick<
  typeof auditLogs.$inferInsert,
  "action" | "targetType" | "targetId" | "before" | "after" | "result"
>;
export type Transaction = Parameters<
  Parameters<Database["db"]["transaction"]>[0]
>[0];
export async function writeAudit(
  db: Database["db"] | Transaction,
  request: FastifyRequest,
  environment: string,
  event: AuditEvent,
) {
  await db.insert(auditLogs).values({
    ...event,
    actorId: request.identity?.id,
    actorAccount: request.identity?.account,
    requestId: request.id,
    environment,
  });
}
