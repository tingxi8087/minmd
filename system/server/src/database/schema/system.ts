import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  primaryKey,
  index,
  check,
} from "drizzle-orm/pg-core";
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => time("created_at").notNull().defaultNow();
export const admins = pgTable(
  "sys_admins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    account: varchar("account", { length: 64 }).notNull().unique(),
    displayName: varchar("display_name", { length: 64 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("enabled"),
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
    lastLoginAt: time("last_login_at"),
    createdAt: createdAt(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("sys_admin_status", sql`${t.status} in ('enabled', 'disabled')`),
    check("sys_admin_account_lower", sql`${t.account} = lower(${t.account})`),
  ],
);
export const roles = pgTable(
  "sys_roles",
  {
    scope: varchar("scope", { length: 16 })
      .$type<"admin" | "app">()
      .notNull()
      .default("admin"),
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 64 }).notNull().unique(),
    name: varchar("name", { length: 64 }).notNull().unique(),
    description: varchar("description", { length: 500 }).notNull().default(""),
    createdAt: createdAt(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [check("sys_role_scope", sql`${t.scope} in ('admin', 'app')`)],
);
export const adminRoles = pgTable(
  "sys_admin_roles",
  {
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.adminId, t.roleId] }),
    index("sys_admin_roles_role_idx").on(t.roleId),
  ],
);
export const rolePermissions = pgTable(
  "sys_role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    // 权限目录由代码维护，写入时由应用校验权限标识。
    permissionCode: varchar("permission_code", { length: 100 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionCode] })],
);
export const sessions = pgTable(
  "sys_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    transport: varchar("transport", { length: 16 }).notNull(),
    expiresAt: time("expires_at").notNull(),
    revokedAt: time("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("sys_sessions_admin_idx").on(t.adminId),
    index("sys_sessions_expiry_idx").on(t.expiresAt),
    check("sys_session_transport", sql`${t.transport} in ('bearer', 'cookie')`),
  ],
);
export const auditLogs = pgTable(
  "sys_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id"),
    actorAccount: varchar("actor_account", { length: 64 }),
    action: varchar("action", { length: 100 }).notNull(),
    targetType: varchar("target_type", { length: 64 }).notNull(),
    targetId: varchar("target_id", { length: 100 }),
    result: varchar("result", { length: 16 }).notNull(),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    requestId: varchar("request_id", { length: 100 }),
    environment: varchar("environment", { length: 16 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("sys_audit_created_idx").on(t.createdAt),
    index("sys_audit_request_idx").on(t.requestId),
    index("sys_audit_actor_idx").on(t.actorId, t.createdAt),
  ],
);
export const runtimeLogs = pgTable(
  "sys_runtime_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    level: varchar("level", { length: 16 }).notNull(),
    message: text("message").notNull(),
    requestId: varchar("request_id", { length: 100 }).notNull(),
    method: varchar("method", { length: 16 }).notNull(),
    path: varchar("path", { length: 500 }).notNull(),
    statusCode: integer("status_code").notNull(),
    durationMs: integer("duration_ms").notNull(),
    environment: varchar("environment", { length: 16 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("sys_runtime_created_idx").on(t.createdAt),
    index("sys_runtime_request_idx").on(t.requestId),
    index("sys_runtime_level_idx").on(t.level, t.createdAt),
  ],
);
