import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { appUsers } from "./users";
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
/** 空间负责人同时属于成员；成员变更与负责人转移使用空间事务锁。 */
export const spaces = pgTable("spaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  description: text("description").notNull().default(""),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => appUsers.id, { onDelete: "restrict" }),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});
/** 空间成员归属是业务资源访问授权的唯一依据。 */
export const spaceMembers = pgTable(
  "space_members",
  {
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    joinedAt: time("joined_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.spaceId, t.userId] }),
    index("space_members_user_idx").on(t.userId),
  ],
);
