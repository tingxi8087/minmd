import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { files } from "./files";
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
/** 分享链接只保存高熵Token哈希，日常配置查询不能恢复完整链接。 */
export const fileShares = pgTable("file_shares", {
  id: uuid("id").defaultRandom().primaryKey(),
  fileId: uuid("file_id")
    .notNull()
    .unique()
    .references(() => files.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  generation: integer("generation").notNull().default(1),
  passwordHash: varchar("password_hash", { length: 300 }),
  expiresAt: time("expires_at"),
  revokedAt: time("revoked_at"),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});
/** 访客授权绑定分享世代；改密、撤销或换Token即时使原授权失效。 */
export const shareGuestSessions = pgTable(
  "share_guest_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shareId: uuid("share_id")
      .notNull()
      .references(() => fileShares.id, { onDelete: "cascade" }),
    generation: integer("generation").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    expiresAt: time("expires_at").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("share_guest_sessions_share_idx").on(t.shareId),
    index("share_guest_sessions_expiry_idx").on(t.expiresAt),
  ],
);
