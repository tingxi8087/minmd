import { resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "../system/server/src/database/client";
import { loadConfig } from "../system/server/src/config/env";

const database = createDatabase(loadConfig().DATABASE_URL);
try {
  await migrate(database.db, {
    migrationsFolder: resolve(import.meta.dir, "migrations"),
  });
  console.log("Database migrations applied.");
} finally {
  await database.close();
}
