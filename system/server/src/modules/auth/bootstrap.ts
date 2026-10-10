import { eq, sql } from "drizzle-orm";
import type { AppConfig } from "../../config/env";
import { createDatabase, type Database } from "../../database/client";
import { admins, auditLogs } from "../../database/schema/system";
import { hashValidatedPassword } from "./password";

/** 首次启动创建超管；已有超管时不验证配置、不修改账号和密码。 */
export async function ensureSuperAdmin(database: Database, config: AppConfig) {
  return database.db.transaction(async (tx) => {
    // 与手动初始化共用事务锁，避免多个进程重复创建。
    await tx.execute(sql`select pg_advisory_xact_lock(731904202)`);
    const [existing] = await tx
      .select({ id: admins.id })
      .from(admins)
      .where(eq(admins.isSuperAdmin, true))
      .limit(1);
    if (existing) return false;
    const account = (config.ADMIN_ACCOUNT ?? "").trim().toLowerCase();
    const password = config.ADMIN_PASSWORD ?? "";
    if (
      !/^[a-z][a-z0-9_]{2,63}$/.test(account) ||
      password.length < 6 ||
      password.length > 128
    ) {
      throw new Error(
        "Invalid configuration: no super administrator exists; set ADMIN_ACCOUNT (3–64 lowercase letters, digits or underscore) and ADMIN_PASSWORD (6–128 characters) in .env.",
      );
    }
    const [admin] = await tx
      .insert(admins)
      .values({
        account,
        displayName: "超级管理员",
        passwordHash: await hashValidatedPassword(password),
        isSuperAdmin: true,
      })
      .returning({ id: admins.id });
    await tx.insert(auditLogs).values({
      actorId: admin!.id,
      actorAccount: account,
      action: "admin.bootstrap",
      targetType: "admin",
      targetId: admin!.id,
      result: "success",
      environment: config.APP_ENV,
      after: { account, displayName: "超级管理员", isSuperAdmin: true },
    });
    return true;
  });
}

export async function initializeSuperAdmin(config: AppConfig) {
  const database = createDatabase(config.DATABASE_URL);
  try {
    await ensureSuperAdmin(database, config);
  } finally {
    await database.close();
  }
}
