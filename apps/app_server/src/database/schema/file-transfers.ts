import { pgTable, uuid, jsonb, timestamp, varchar } from "drizzle-orm/pg-core";
import { spaces } from "./spaces";
import { appUsers } from "./users";
import { files } from "./files";

/** 仅保存成功导入的身份、目标和结果，用于响应丢失及重启后的幂等重试；不保存包或正文。 */
export const fileTransferImports = pgTable("file_transfer_imports", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => appUsers.id, { onDelete: "cascade" }),
  spaceId: uuid("space_id")
    .notNull()
    .references(() => spaces.id, { onDelete: "cascade" }),
  targetFileId: uuid("target_file_id").references(() => files.id, {
    onDelete: "set null",
  }),
  fileIds: jsonb("file_ids").$type<string[]>().notNull(),
  /** 复制请求的参数摘要；普通文件包导入不使用。 */
  requestFingerprint: varchar("request_fingerprint", { length: 64 }),
  importedAt: timestamp("imported_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});
