import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { files } from "./files";
import { appUsers } from "./users";
import { fileShares } from "./shares";
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
/** 独立文件授权不授予空间成员资格；空间成员的显式设置覆盖空间默认权限。 */
export const fileAccessGrants = pgTable(
  "file_access_grants",
  {
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    permission: varchar("permission", { length: 16 })
      .$type<"read" | "edit">()
      .notNull(),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.fileId, t.userId] }),
    index("file_access_grants_user_idx").on(t.userId),
    check(
      "file_access_grants_permission",
      sql`${t.permission} in ('read','edit')`,
    ),
  ],
);
/** 同一用户同一文件保存最新申请；审批事务同时更新授权和通知。 */
export const fileAccessRequests = pgTable(
  "file_access_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    permission: varchar("permission", { length: 16 })
      .$type<"read" | "edit">()
      .notNull(),
    reason: text("reason").notNull().default(""),
    status: varchar("status", { length: 16 })
      .$type<"pending" | "approved" | "rejected" | "cancelled">()
      .notNull()
      .default("pending"),
    decidedBy: uuid("decided_by").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    decidedAt: time("decided_at"),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("file_access_requests_file_user_idx").on(t.fileId, t.userId),
    index("file_access_requests_status_idx").on(t.fileId, t.status),
    check(
      "file_access_requests_permission",
      sql`${t.permission} in ('read','edit')`,
    ),
    check(
      "file_access_requests_status",
      sql`${t.status} in ('pending','approved','rejected','cancelled')`,
    ),
  ],
);
/** 登录用户验证公开链接后获得短期链接授权，仍受分享世代、密码与到期校验。 */
export const shareUserSessions = pgTable(
  "share_user_sessions",
  {
    shareId: uuid("share_id")
      .notNull()
      .references(() => fileShares.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    generation: integer("generation").notNull(),
    expiresAt: time("expires_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.shareId, t.userId] })],
);
/** 站内通知仅存白名单业务结果，按接收人隔离。 */
export const appNotifications = pgTable(
  "app_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").references(() => files.id, {
      onDelete: "set null",
    }),
    message: text("message").notNull(),
    readAt: time("read_at"),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [index("app_notifications_user_idx").on(t.userId, t.createdAt)],
);
