import { adminPermissions, appPermissions } from "../config/permissions";
import { expect, test } from "bun:test";
import { createApp, loadConfig } from "../system/server/src/index";
import type { Database } from "../system/server/src/database/client";

const config = loadConfig({
  DATABASE_URL: "postgresql://localhost/unused_test",
  APP_ENV: "development",
  LOG_LEVEL: "silent",
});
test("factory exposes shared dependencies and closes its pool once on normal close", async () => {
  let database!: Database;
  let closes = 0;
  const app = await createApp({
    permissions: { admin: adminPermissions, app: appPermissions },
    config,
    options: { logger: false },
    register: async (_app, context) => {
      expect(context.config).toBe(config);
      database = context.database;
      const close = database.close;
      database.close = () => {
        closes++;
        return close();
      };
    },
  });
  expect(app.server.listening).toBe(false);
  await app.close();
  await app.close();
  expect(closes).toBe(1);
});
test("factory cleans up a failed business registration without replacing its error", async () => {
  let database!: Database;
  let closes = 0;
  const error = new Error("business registration failure");
  await expect(
    createApp({
      permissions: { admin: adminPermissions, app: appPermissions },
      config,
      options: { logger: false },
      register: async (_app, context) => {
        database = context.database;
        const close = database.close;
        database.close = () => {
          closes++;
          return close();
        };
        throw error;
      },
    }),
  ).rejects.toBe(error);
  expect(closes).toBe(1);
  await expect(database.pool.query("select 1")).rejects.toThrow(
    "Cannot use a pool after calling end",
  );
});
test("missing web-cms build also releases the database", async () => {
  let closes = 0;
  await expect(
    createApp({
      permissions: { admin: adminPermissions, app: appPermissions },
      config: {
        ...config,
        APP_ENV: "staging",
        WEB_CMS_DIST: "/nonexistent/mas-web-cms",
      },
      options: { logger: false },
      register: async (_app, { database }) => {
        const close = database.close;
        database.close = () => {
          closes++;
          return close();
        };
      },
    }),
  ).rejects.toThrow("Web CMS build missing");
  expect(closes).toBe(1);
});
