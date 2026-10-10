import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../system/server/src/database/client";
import { loadConfig } from "../system/server/src/config/env";
import { admins, auditLogs } from "../system/server/src/database/schema/system";
import { hashPassword } from "../system/server/src/modules/auth/password";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
try {
  const command = process.argv[2];
  if (command === "create-super-admin") {
    const account = (process.env.ADMIN_ACCOUNT ?? "").trim().toLowerCase();
    const displayName = "超级管理员";
    if (
      !/^[a-z][a-z0-9_]{2,63}$/.test(account) ||
      !displayName ||
      displayName.length > 64
    )
      throw new Error(
        "Set ADMIN_ACCOUNT (3–64 lowercase letters, digits or underscore).",
      );
    // Password comes from stdin, never from command arguments or command output.
    const password = (await Bun.stdin.text()).replace(/\r?\n$/, "");
    const passwordHash = await hashPassword(password);
    await database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(731904202)`);
      if (
        (
          await tx
            .select({ id: admins.id })
            .from(admins)
            .where(eq(admins.isSuperAdmin, true))
        ).length
      )
        throw new Error(
          "A super administrator already exists; initialization cannot run again.",
        );
      const [admin] = await tx
        .insert(admins)
        .values({ account, displayName, passwordHash, isSuperAdmin: true })
        .returning({ id: admins.id });
      await tx.insert(auditLogs).values({
        actorId: admin!.id,
        actorAccount: account,
        action: "admin.bootstrap",
        targetType: "admin",
        targetId: admin!.id,
        result: "success",
        environment: config.APP_ENV,
        after: { account, displayName, isSuperAdmin: true },
      });
    });
    console.log("Initial super administrator created.");
  } else
    throw new Error(
      "Usage: bun scripts/auth-setup.ts create-super-admin (password from stdin)",
    );
} catch (error) {
  // Database driver errors can include bound credentials; only application errors are printed.
  console.error(
    error instanceof Error && !("query" in error) && !("code" in error)
      ? error.message
      : "Initialization failed; check database availability and account uniqueness.",
  );
  process.exitCode = 1;
} finally {
  await database.close();
}
