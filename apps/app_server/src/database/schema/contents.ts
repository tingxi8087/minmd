import {
  pgTable,
  uuid,
  integer,
  varchar,
  text,
  timestamp,
  jsonb,
  customType,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { files } from "./files";
import { appUsers } from "./users";
const binary = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
/** 引擎状态与读取投影在同一事务落盘，epoch 隔离恢复前的客户端。 */
export const fileContents = pgTable("file_contents", {
  fileId: uuid("file_id")
    .primaryKey()
    .references(() => files.id, { onDelete: "cascade" }),
  engine: varchar("engine", { length: 20 }).notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  revision: integer("revision").notNull().default(1),
  epoch: integer("epoch").notNull().default(1),
  projection: jsonb("projection").$type<Record<string, unknown>>().notNull(),
  projectionRevision: integer("projection_revision").notNull().default(1),
  documentState: binary("document_state"),
  engineState: jsonb("engine_state").$type<Record<string, unknown>>(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});
/** Yjs 更新日志只有在权威检查点成功写入后才可压缩。 */
export const documentUpdates = pgTable(
  "document_updates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    epoch: integer("epoch").notNull(),
    revision: integer("revision").notNull(),
    update: binary("update").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("document_updates_revision_idx").on(
      t.fileId,
      t.epoch,
      t.revision,
    ),
  ],
);
/** 完整历史快照，恢复始终创建新 epoch，不删除旧历史。 */
export const fileVersions = pgTable(
  "file_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    epoch: integer("epoch").notNull(),
    source: varchar("source", { length: 20 }).notNull(),
    actorId: uuid("actor_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    note: text("note").notNull().default(""),
    projection: jsonb("projection").$type<Record<string, unknown>>().notNull(),
    documentState: binary("document_state"),
    engineState: jsonb("engine_state").$type<Record<string, unknown>>(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [index("file_versions_file_idx").on(t.fileId, t.createdAt)],
);
