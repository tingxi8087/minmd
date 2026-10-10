import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

export function createDatabase(url: string) {
  const pool = new Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  const db = drizzle(pool);
  return { db, pool, close: () => pool.end() };
}
export type Database = ReturnType<typeof createDatabase>;
