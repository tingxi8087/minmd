import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { buildApp } from "../../apps/app_server/src/app";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import { hashPassword } from "../../system/server/src/modules/auth/password";
import {
  admins,
  auditLogs,
} from "../../system/server/src/database/schema/system";
import {
  appUsers,
  appInstallation,
  appUserRoles,
  appUserSessions,
} from "../../apps/app_server/src/database/schema/users";
import {
  spaces,
  spaceMembers,
} from "../../apps/app_server/src/database/schema/spaces";
import { files } from "../../apps/app_server/src/database/schema/files";
import {
  fileContents,
  fileVersions,
} from "../../apps/app_server/src/database/schema/contents";
import { documentProjection } from "../../apps/app_server/src/modules/collaboration/document-schema";
import * as Y from "yjs";
const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw new Error("首次使用测试仅允许独立 _test 数据库");
const suite = url ? describe : describe.skip;
suite("首次使用与后台默认空间", () => {
  const db = createDatabase(url ?? "postgresql://localhost/unused_test");
  const origin = "http://127.0.0.1:9819";
  const prefix = `setup_${Date.now()}`;
  const payload = {
    account: `${prefix}_first`,
    password: "123456",
    spaceName: "我的测试空间",
  };
  let app: Awaited<ReturnType<typeof buildApp>>;
  let rootId: string;
  let savedState: (typeof appInstallation.$inferSelect)[] = [];
  let adminHeaders: { cookie: string; origin: string; "x-csrf-token": string };
  let address = 1;
  const setup = (body = payload, requestOrigin: string | null = origin) =>
    app.inject({
      method: "POST",
      url: "/api/app/auth/setup",
      remoteAddress: `127.0.1.${address++}`,
      headers: requestOrigin ? { origin: requestOrigin } : {},
      payload: body,
    });
  const status = async () =>
    (await app.inject("/api/app/auth/setup")).json().needsSetup as boolean;
  const clearUsers = async () => {
    const users = await db.db
      .select({ id: appUsers.id, account: appUsers.account })
      .from(appUsers);
    if (users.some((u) => !u.account.startsWith(prefix)))
      throw new Error("首次使用测试不能删除其他测试的账号");
    for (const user of users) {
      const owned = await db.db
        .select({ id: spaces.id })
        .from(spaces)
        .where(eq(spaces.ownerId, user.id));
      for (const space of owned) {
        await db.db.delete(files).where(eq(files.spaceId, space.id));
        await db.db.delete(spaces).where(eq(spaces.id, space.id));
      }
      await db.db.delete(appUsers).where(eq(appUsers.id, user.id));
    }
  };
  const reset = async () => {
    await clearUsers();
    await db.db.delete(appInstallation);
  };
  const managedInput = (suffix: string, createDefaultSpace?: boolean) => ({
    account: `${prefix}_${suffix}`,
    nickname: "小明",
    password: "123456",
    avatar: "",
    metadata: {},
    roles: [],
    ...(createDefaultSpace === undefined ? {} : { createDefaultSpace }),
  });
  beforeAll(async () => {
    expect(await db.db.select().from(appUsers)).toHaveLength(0);
    savedState = await db.db.select().from(appInstallation);
    await db.db.delete(appInstallation);
    const [root] = await db.db
      .insert(admins)
      .values({
        account: `${prefix}_root`,
        displayName: "初始化测试",
        passwordHash: await hashPassword("Setup-admin-test-123!"),
        isSuperAdmin: true,
      })
      .returning();
    rootId = root!.id;
    app = await buildApp(
      loadConfig({
        DATABASE_URL: url!,
        APP_ENV: "staging",
        WEB_CMS_DIST: "tests/fixtures/web-cms",
        WEB_DIST: "tests/fixtures/web",
        LOG_LEVEL: "silent",
        AUTH_TRANSPORT: "cookie",
        PUBLIC_ORIGIN: origin,
      }),
      { logger: false },
      { registrationEnabled: false, allowedOrigins: [origin] },
    );
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin },
      payload: { account: root!.account, password: "Setup-admin-test-123!" },
    });
    expect(login.statusCode).toBe(200);
    adminHeaders = {
      cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
      origin,
      "x-csrf-token": login.json().csrfToken,
    };
  });
  afterAll(async () => {
    await app?.close();
    await db.pool.query("DROP TRIGGER IF EXISTS setup_fail_guide ON files");
    await db.pool.query("DROP FUNCTION IF EXISTS setup_fail_guide()");
    await clearUsers();
    await db.db.delete(appInstallation);
    if (savedState.length)
      await db.db.insert(appInstallation).values(savedState);
    await db.db
      .delete(auditLogs)
      .where(
        sql`${auditLogs.action} = 'app.setup' or ${auditLogs.actorId} = ${rootId ?? null}`,
      );
    if (rootId) await db.db.delete(admins).where(eq(admins.id, rootId));
    await db.close();
  });
  test("仅后台账号不阻止初始化，状态禁缓存，来源/密码/权限字段严格校验", async () => {
    const state = await app.inject("/api/app/auth/setup");
    expect(state.headers["cache-control"]).toBe("no-store");
    expect(state.json<{ needsSetup: boolean }>()).toEqual({ needsSetup: true });
    expect((await setup(payload, "https://foreign.invalid")).statusCode).toBe(
      403,
    );
    expect((await setup(payload, null)).statusCode).toBe(403);
    expect((await setup({ ...payload, password: "12345" })).statusCode).toBe(
      400,
    );
    expect((await setup({ ...payload, spaceName: "  " })).statusCode).toBe(400);
    expect(
      (await setup({ ...payload, roles: [] } as typeof payload)).statusCode,
    ).toBe(400);
    expect(
      (
        await setup({
          ...payload,
          description: "x".repeat(2001),
        } as typeof payload)
      ).statusCode,
    ).toBe(400);
    expect(await db.db.select().from(appUsers)).toHaveLength(0);
  });
  test("已有停用前台账号也不开放匿名初始化", async () => {
    const [user] = await db.db
      .insert(appUsers)
      .values({
        account: `${prefix}_legacy`,
        passwordHash: await hashPassword("Existing-user-test-123!"),
        status: "disabled",
      })
      .returning();
    try {
      expect(await status()).toBe(false);
      expect((await setup()).statusCode).toBe(409);
    } finally {
      await db.db.delete(appUsers).where(eq(appUsers.id, user!.id));
    }
    expect(await status()).toBe(true);
  });
  test("创建账号/空间/引导文档/初始版本/会话原子提交；Cookie自动登录且可正常编辑", async () => {
    const result = await setup({
      ...payload,
      account: payload.account.toUpperCase(),
      nickname: "  ",
    } as typeof payload);
    expect(result.statusCode).toBe(200);
    const response = result.json();
    expect(response.token).toBeUndefined();
    expect(response.csrfToken).toHaveLength(64);
    const cookie = result.cookies[0]!;
    expect(cookie.name).toBe("mas_app_session");
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.path).toBe("/api/app");
    const headers = {
      cookie: `${cookie.name}=${cookie.value}`,
      origin,
      "x-csrf-token": response.csrfToken,
    };
    const me = await app.inject({ url: "/api/app/auth/me", headers });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({
      account: payload.account,
      nickname: payload.account,
      roles: [],
    });
    const [user] = await db.db.select().from(appUsers);
    expect(
      await Bun.password.verify(payload.password, user!.passwordHash),
    ).toBe(true);
    expect(await db.db.select().from(appUserRoles)).toHaveLength(0);
    const [space] = await db.db
      .select()
      .from(spaces)
      .where(eq(spaces.id, response.spaceId));
    expect(space).toMatchObject({
      name: payload.spaceName,
      description: "",
      ownerId: user!.id,
    });
    expect(
      await db.db
        .select()
        .from(spaceMembers)
        .where(eq(spaceMembers.spaceId, space!.id)),
    ).toHaveLength(1);
    const [file] = await db.db
      .select()
      .from(files)
      .where(eq(files.id, response.documentId));
    expect(file).toMatchObject({
      name: "欢迎使用 minmd",
      visibility: "private",
      createdBy: user!.id,
    });
    const [content] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, file!.id));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, content!.documentState!);
    expect(documentProjection(doc)).toEqual(content!.projection);
    doc.destroy();
    expect(JSON.stringify(content!.projection)).toContain("Command / Ctrl + S");
    expect(
      await db.db
        .select()
        .from(fileVersions)
        .where(eq(fileVersions.fileId, file!.id)),
    ).toHaveLength(1);
    const rename = await app.inject({
      method: "PATCH",
      url: `/api/app/files/${file!.id}`,
      headers,
      payload: {
        name: "我的第一篇笔记",
        expectedMetadataRevision: file!.metadataRevision,
      },
    });
    expect(rename.statusCode).toBe(200);
    expect(await status()).toBe(false);
    const audits = await db.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "app.setup"));
    expect(JSON.stringify(audits)).not.toContain(payload.password);
    expect(JSON.stringify(audits)).not.toContain(cookie.value);
    await app.close();
    app = await buildApp(
      loadConfig({
        DATABASE_URL: url!,
        APP_ENV: "staging",
        WEB_CMS_DIST: "tests/fixtures/web-cms",
        WEB_DIST: "tests/fixtures/web",
        LOG_LEVEL: "silent",
        AUTH_TRANSPORT: "cookie",
        PUBLIC_ORIGIN: origin,
      }),
      { logger: false },
      { registrationEnabled: false, allowedOrigins: [origin] },
    );
    expect(await status()).toBe(false);
    expect(
      (await app.inject({ url: "/api/app/auth/me", headers })).statusCode,
    ).toBe(200);
  });
  test("删除全部前台数据后完成标记仍拒绝匿名初始化", async () => {
    await clearUsers();
    expect(await status()).toBe(false);
    expect((await setup()).statusCode).toBe(409);
    expect(await db.db.select().from(appUsers)).toHaveLength(0);
  });
  test("两个并发初始化只成功一次，无重复空间、文档或会话", async () => {
    await reset();
    const results = await Promise.all([
      setup(),
      setup({ ...payload, account: `${prefix}_second` }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await db.db.select().from(appUsers)).toHaveLength(1);
    const [user] = await db.db.select().from(appUsers);
    const owned = await db.db
      .select()
      .from(spaces)
      .where(eq(spaces.ownerId, user!.id));
    expect(owned).toHaveLength(1);
    expect(
      await db.db.select().from(files).where(eq(files.spaceId, owned[0]!.id)),
    ).toHaveLength(1);
    expect(
      await db.db
        .select()
        .from(appUserSessions)
        .where(eq(appUserSessions.userId, user!.id)),
    ).toHaveLength(1);
  });
  test("引导文档写入失败，账号、空间、会话和完成标记全部回滚，可重试", async () => {
    await reset();
    await db.pool.query(
      "CREATE FUNCTION setup_fail_guide() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name = '欢迎使用 minmd' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$",
    );
    await db.pool.query(
      "CREATE TRIGGER setup_fail_guide BEFORE INSERT ON files FOR EACH ROW EXECUTE FUNCTION setup_fail_guide()",
    );
    try {
      const result = await setup();
      expect(result.statusCode).toBe(500);
      expect(result.cookies).toHaveLength(0);
      expect(result.body).not.toContain("fixture");
      expect(await db.db.select().from(appUsers)).toHaveLength(0);
      expect(await db.db.select().from(appInstallation)).toHaveLength(0);
      expect(
        await db.db
          .select()
          .from(spaces)
          .where(eq(spaces.name, payload.spaceName)),
      ).toHaveLength(0);
      expect(await db.db.select().from(appUserSessions)).toHaveLength(0);
      expect(await status()).toBe(true);
    } finally {
      await db.pool.query("DROP TRIGGER setup_fail_guide ON files");
      await db.pool.query("DROP FUNCTION setup_fail_guide()");
    }
    expect((await setup()).statusCode).toBe(200);
  });
  test("后台勾选创建默认空间；取消/缺省仅账号；编辑不能补建空间", async () => {
    await reset();
    for (const [suffix, enabled] of [
      ["with", true],
      ["without", false],
      ["omitted", undefined],
    ] as const) {
      const input = managedInput(suffix, enabled);
      const result = await app.inject({
        method: "POST",
        url: "/api/admin/app-users",
        headers: adminHeaders,
        payload: input,
      });
      expect(result.statusCode).toBe(200);
      const [user] = await db.db
        .select()
        .from(appUsers)
        .where(eq(appUsers.account, input.account));
      const owned = await db.db
        .select()
        .from(spaces)
        .where(eq(spaces.ownerId, user!.id));
      expect(owned).toHaveLength(enabled ? 1 : 0);
      if (enabled) expect(owned[0]!.name).toBe("小明的空间");
      const { password: _, ...edit } = input;
      expect(
        (
          await app.inject({
            method: "PUT",
            url: `/api/admin/app-users/${user!.id}`,
            headers: adminHeaders,
            payload: { ...edit, createDefaultSpace: true },
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(await status()).toBe(false);
  });
  test("后台无效角色会回滚账号与默认空间，后台创建和匿名初始化共用锁", async () => {
    await reset();
    const invalid = await app.inject({
      method: "POST",
      url: "/api/admin/app-users",
      headers: adminHeaders,
      payload: {
        ...managedInput("invalid", true),
        roles: [crypto.randomUUID()],
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(await status()).toBe(true);
    expect(await db.db.select().from(appUsers)).toHaveLength(0);
    const results = await Promise.all([
      setup(),
      app.inject({
        method: "POST",
        url: "/api/admin/app-users",
        headers: adminHeaders,
        payload: managedInput("race", false),
      }),
    ]);
    expect(results[1]!.statusCode).toBe(200);
    expect([200, 409]).toContain(results[0]!.statusCode);
    expect(await status()).toBe(false);
    expect((await setup()).statusCode).toBe(409);
  });
});
