import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  primaryKey,
  index,
  check,
} from "drizzle-orm/pg-core";
import { roles } from "../../../../../system/server/src/database/schema/system";
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
/** 前台账号；额外资料不能用作角色、状态等授权依据。 */
export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    account: varchar("account", { length: 64 }).notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    nickname: varchar("nickname", { length: 64 }).notNull().default(""),
    avatar: varchar("avatar", { length: 1000 }).notNull().default(""),
    status: varchar("status", { length: 16 }).notNull().default("enabled"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    lastLoginAt: time("last_login_at"),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("app_user_status", sql`${t.status} in ('enabled', 'disabled')`),
    check("app_user_account_lower", sql`${t.account} = lower(${t.account})`),
    check(
      "app_user_metadata_object",
      sql`jsonb_typeof(${t.metadata}) = 'object'`,
    ),
  ],
);
export const appUserRoles = pgTable(
  "app_user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    index("app_user_roles_role_idx").on(t.roleId),
  ],
);
export const appUserSessions = pgTable(
  "app_user_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    transport: varchar("transport", { length: 16 }).notNull(),
    expiresAt: time("expires_at").notNull(),
    revokedAt: time("revoked_at"),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("app_user_sessions_user_idx").on(t.userId),
    index("app_user_sessions_expiry_idx").on(t.expiresAt),
    check("app_session_transport", sql`${t.transport} in ('bearer', 'cookie')`),
  ],
);
