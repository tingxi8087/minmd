import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import {
  admins,
  auditLogs,
} from "../../system/server/src/database/schema/system";
import { ensureSuperAdmin } from "../../system/server/src/modules/auth/bootstrap";

const url = process.env.TEST_DATABASE_URL;
// 此测试验证空库初始化，只允许独立测试库。
const run = url && new URL(url).pathname.endsWith("_test") ? test : test.skip;
run(
  "first-start bootstrap is atomic, accepts configured default and never overwrites an existing admin",
  async () => {
    const database = createDatabase(url!);
    const config = loadConfig({
      DATABASE_URL: url,
      ADMIN_ACCOUNT: "admin",
      ADMIN_PASSWORD: "123456",
    });
    let id: string | undefined;
    try {
      await expect(
        ensureSuperAdmin(database, { ...config, ADMIN_PASSWORD: undefined }),
      ).rejects.toThrow("Invalid configuration");
      const results = await Promise.all([
        ensureSuperAdmin(database, config),
        ensureSuperAdmin(database, config),
      ]);
      expect(results.sort()).toEqual([false, true]);
      const [admin] = await database.db
        .select()
        .from(admins)
        .where(eq(admins.isSuperAdmin, true));
      id = admin!.id;
      expect(admin!.account).toBe("admin");
      expect(admin!.passwordHash).not.toBe("123456");
      expect(await Bun.password.verify("123456", admin!.passwordHash)).toBe(
        true,
      );
      expect(
        await ensureSuperAdmin(database, {
          ...config,
          ADMIN_ACCOUNT: "changed",
          ADMIN_PASSWORD: "changed-password",
        }),
      ).toBe(false);
      expect(
        await ensureSuperAdmin(database, {
          ...config,
          ADMIN_ACCOUNT: undefined,
          ADMIN_PASSWORD: undefined,
        }),
      ).toBe(false);
      const [after] = await database.db
        .select()
        .from(admins)
        .where(eq(admins.id, id!));
      expect(after).toEqual(admin);
      const audit = await database.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.actorId, id!));
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain("123456");
    } finally {
      if (id) {
        await database.db.delete(auditLogs).where(eq(auditLogs.actorId, id));
        await database.db.delete(admins).where(eq(admins.id, id));
      }
      await database.close();
    }
  },
);
