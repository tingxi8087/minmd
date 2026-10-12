import { afterAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../../system/server/src/database/client";
import { appUsers } from "../../apps/app_server/src/database/schema/users";
import { AiExecution } from "../../apps/app_server/src/modules/ai/execution";

const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw Error("AI超时测试只允许独立_test数据库");
(url ? describe : describe.skip)("AI执行期限与事务回滚", () => {
  const database = createDatabase(url ?? "postgresql://localhost/unused_test");
  afterAll(() => database.close());
  test("计算超过期限时，提交前拒绝且数据库不保留部分写入", async () => {
    let elapsed = 0;
    const guard = new AiExecution(100, () => elapsed);
    const id = crypto.randomUUID();
    await expect(
      guard.transaction(database, async (tx) => {
        await tx
          .insert(appUsers)
          .values({
            id,
            account: `deadline_${id}`,
            passwordHash: "non-login-fixture",
          });
        elapsed = 101;
      }),
    ).rejects.toMatchObject({ code: "AI_EXECUTION_TIMEOUT", statusCode: 503 });
    expect(
      await database.db.select().from(appUsers).where(eq(appUsers.id, id)),
    ).toEqual([]);
  });
  test("数据库超时取消实际查询并回滚前面的写入", async () => {
    const guard = new AiExecution(100);
    const id = crypto.randomUUID();
    await expect(
      guard.transaction(database, async (tx) => {
        await tx
          .insert(appUsers)
          .values({
            id,
            account: `sql_deadline_${id}`,
            passwordHash: "non-login-fixture",
          });
        await tx.execute(sql`select pg_sleep(0.3)`);
      }),
    ).rejects.toMatchObject({ code: "AI_EXECUTION_TIMEOUT", statusCode: 503 });
    expect(
      await database.db.select().from(appUsers).where(eq(appUsers.id, id)),
    ).toEqual([]);
    expect(
      (await database.db.execute(sql`select 1 as connected`)).rows[0],
    ).toEqual({ connected: 1 });
  });
});
