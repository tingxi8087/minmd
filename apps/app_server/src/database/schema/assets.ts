import {
  pgTable,
  uuid,
  varchar,
  bigint,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { spaces } from "./spaces";
import { files } from "./files";
import { fileVersions } from "./contents";
import { appUsers } from "./users";
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
/** 原文件存放私有目录，存储键不接受用户路径。 */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "restrict" }),
    storageKey: varchar("storage_key", { length: 80 }).notNull().unique(),
    filename: varchar("filename", { length: 200 }).notNull(),
    mime: varchar("mime", { length: 120 }).notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    checksum: varchar("checksum", { length: 64 }).notNull(),
    uploadedForFileId: uuid("uploaded_for_file_id").references(() => files.id, {
      onDelete: "set null",
    }),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [index("assets_unbound_idx").on(t.createdAt)],
);
export const fileAssets = pgTable(
  "file_assets",
  {
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.assetId] })],
);
/** 历史独立引用，当前正文删除图片不破坏旧版本。 */
export const versionAssets = pgTable(
  "version_assets",
  {
    versionId: uuid("version_id")
      .notNull()
      .references(() => fileVersions.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.assetId] })],
);
