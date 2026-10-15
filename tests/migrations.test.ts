import { expect, test } from "bun:test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { resolve } from "node:path";

test("初始化基线保留旧链末次迁移时间，已升级的数据库不会再次执行建表", () => {
  const migrations = readMigrationFiles({
    migrationsFolder: resolve(import.meta.dir, "../database/migrations"),
  });
  // Drizzle 以时间判断是否执行；改成重新生成时的当前时间会破坏旧库兼容。
  expect(migrations[0]!.folderMillis).toBe(1792025261248);
});
