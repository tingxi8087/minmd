import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { buildApp } from "../../apps/app_server/src/app";
import { appUsers } from "../../apps/app_server/src/database/schema/users";
import { spaces } from "../../apps/app_server/src/database/schema/spaces";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import { loadMinmdConfig } from "../../config/minmd";
import { hashValidatedPassword } from "../../system/server/src/modules/auth/password";

const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw new Error("来源校验只允许独立 _test 数据库");
(url ? test : test.skip)(
  "统一来源可用 Cookie 创建空间，错误来源和缺失 CSRF 仍被拒绝",
  async () => {
    const db = createDatabase(url!);
    const account = `origin_${Date.now()}`;
    const config = loadConfig({
      DATABASE_URL: url!,
      AUTH_TRANSPORT: "cookie",
      PUBLIC_ORIGIN: "http://127.0.0.1:9811",
      LOG_LEVEL: "silent",
    });
    const app = await buildApp(
      config,
      { logger: false },
      loadMinmdConfig(config, {}),
    );
    let userId: string | undefined;
    try {
      const [user] = await db.db
        .insert(appUsers)
        .values({
          account,
          nickname: "来源测试",
          passwordHash: await hashValidatedPassword("246810"),
        })
        .returning();
      userId = user!.id;
      const login = await app.inject({
        method: "POST",
        url: "/api/app/auth/login",
        payload: { account, password: "246810" },
      });
      expect(login.statusCode).toBe(200);
      const cookie = login.cookies
        .map((item) => `${item.name}=${item.value}`)
        .join("; ");
      const headers = {
        cookie,
        origin: config.PUBLIC_ORIGIN,
        "x-csrf-token": login.json().csrfToken as string,
      };
      const create = (requestHeaders: Record<string, string>) =>
        app.inject({
          method: "POST",
          url: "/api/app/spaces",
          headers: requestHeaders,
          payload: { name: "统一来源测试" },
        });
      expect(
        (await create({ ...headers, origin: "http://127.0.0.1:5173" }))
          .statusCode,
      ).toBe(403);
      const missing: Record<string, string> = { ...headers };
      delete missing["x-csrf-token"];
      expect((await create(missing)).statusCode).toBe(403);
      expect(
        (await create({ ...headers, "x-csrf-token": "0".repeat(64) }))
          .statusCode,
      ).toBe(403);
      expect((await create(headers)).statusCode).toBe(200);
    } finally {
      await app.close();
      if (userId) {
        await db.db.delete(spaces).where(eq(spaces.ownerId, userId));
        await db.db.delete(appUsers).where(eq(appUsers.id, userId));
      }
      await db.close();
    }
  },
);
