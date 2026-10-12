import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { spaces } from "./spaces";
import { appUsers } from "./users";
export interface DemoImportResult {
  oldId: string;
  fileId: string;
  status: "success" | "failed";
  message: string;
}
/** 演示迁移只记录身份限定的映射和结果，不保存密码、密钥或原始演示正文。 */
export const demoImports = pgTable(
  "demo_imports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull(),
    manifestHash: varchar("manifest_hash", { length: 64 }).notNull(),
    mapping: jsonb("mapping").$type<Record<string, string>>().notNull(),
    results: jsonb("results").$type<DemoImportResult[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("demo_imports_identity_key_idx").on(
      t.userId,
      t.spaceId,
      t.idempotencyKey,
    ),
  ],
);
