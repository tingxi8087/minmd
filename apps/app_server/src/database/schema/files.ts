import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  integer,
  doublePrecision,
  timestamp,
  primaryKey,
  index,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { spaces } from "./spaces";
import { appUsers } from "./users";
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
/** 文件树元数据；正文权威状态由协作模块管理，元数据修订与正文分开。 */
export const files = pgTable(
  "files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "restrict" }),
    kind: varchar("kind", { length: 16 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => files.id, {
      onDelete: "restrict",
    }),
    position: doublePrecision("position").notNull().default(0),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    visibility: varchar("visibility", { length: 16 })
      .notNull()
      .default("private"),
    memberPermission: varchar("member_permission", { length: 16 })
      .$type<"read" | "edit">()
      .notNull()
      .default("read"),
    metadataRevision: integer("metadata_revision").notNull().default(1),
    deletedBatch: uuid("deleted_batch"),
    deletedAt: time("deleted_at"),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("files_tree_idx").on(t.spaceId, t.parentId, t.deletedAt, t.position),
    index("files_deleted_batch_idx").on(t.spaceId, t.deletedBatch),
    check(
      "files_member_permission",
      sql`${t.memberPermission} in ('read','edit')`,
    ),
    check("files_kind", sql`${t.kind} in ('doc','sheet','slide','folder')`),
    check("files_visibility", sql`${t.visibility} in ('public','private')`),
  ],
);
/** 收藏记录按当前账号隔离。 */
export const fileFavorites = pgTable(
  "file_favorites",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.fileId] })],
);
/** 最近访问不记录正文或隐私数据，仅保存当前账号访问时间。 */
export const fileVisits = pgTable(
  "file_visits",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    visitedAt: time("visited_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.fileId] }),
    index("file_visits_user_time_idx").on(t.userId, t.visitedAt),
  ],
);
