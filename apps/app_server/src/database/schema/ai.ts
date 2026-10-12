import {
  pgTable,
  uuid,
  boolean,
  jsonb,
  varchar,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { spaces } from "./spaces";
import { appUsers } from "./users";

export const aiPermissions = [
  "read",
  "create",
  "edit",
  "organize",
  "delete_restore",
  "upload",
] as const;
export type AiPermission = (typeof aiPermissions)[number];
/** 空间策略实时参与每一次外部调用授权，关闭后不删除密钥签发范围。 */
export const spaceAiPolicies = pgTable("space_ai_policies", {
  spaceId: uuid("space_id")
    .primaryKey()
    .references(() => spaces.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  permissions: jsonb("permissions")
    .$type<AiPermission[]>()
    .notNull()
    .default(["read"]),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
/** API Key仅存哈希，创建者退出空间或停用后即失效。 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    prefix: varchar("prefix", { length: 20 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    permissions: jsonb("permissions").$type<AiPermission[]>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("api_keys_space_idx").on(t.spaceId, t.createdBy)],
);
/** 成功写命令的结果随业务事务提交；相同主体和请求ID不得产生第二次副作用。 */
export const aiRequests = pgTable(
  "ai_requests",
  {
    keyId: uuid("key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    requestId: varchar("request_id", { length: 100 }).notNull(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.keyId, t.requestId] })],
);
