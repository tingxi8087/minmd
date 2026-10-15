import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { buildApp } from "../../apps/app_server/src/app";
import { loadConfig } from "../../system/server/src/config/env";
import { createDatabase } from "../../system/server/src/database/client";
import { hashPassword } from "../../system/server/src/modules/auth/password";
import {
  admins,
  auditLogs,
} from "../../system/server/src/database/schema/system";
import { appUsers } from "../../apps/app_server/src/database/schema/users";
import { spaces } from "../../apps/app_server/src/database/schema/spaces";
import { files } from "../../apps/app_server/src/database/schema/files";

const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw new Error("HTTP 直连测试仅允许独立 _test 数据库");
(url ? describe : describe.skip)("生产 HTTP IP 直连认证及权限", () => {
  const db = createDatabase(url ?? "postgresql://localhost/unused_test");
  const origin = "http://192.168.1.10:9811",
    password = "Direct-test-123456",
    account = `direct_${Date.now()}`;
  const previous = process.env.APP_PUBLIC_ORIGIN;
  let app: Awaited<ReturnType<typeof buildApp>>,
    userId: string,
    adminId: string,
    spaceId: string,
    fileId: string;
  let userHeaders: { cookie: string; origin: string; "x-csrf-token": string };
  let adminHeaders: typeof userHeaders;
  const assertCookie = (value: string | string[] | number | undefined) => {
    expect(String(value)).toContain("HttpOnly");
    expect(String(value)).toContain("SameSite=Strict");
    expect(String(value)).not.toMatch(/;\s*Secure/i);
  };
  const headers = (reply: {
    cookies: { name: string; value: string }[];
    json(): { csrfToken: string };
  }) => ({
    cookie: reply.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    origin,
    "x-csrf-token": reply.json().csrfToken,
  });
  beforeAll(async () => {
    process.env.APP_PUBLIC_ORIGIN = origin;
    const passwordHash = await hashPassword(password);
    [userId, adminId] = await Promise.all([
      db.db
        .insert(appUsers)
        .values({ account, nickname: "直连用户", passwordHash })
        .returning()
        .then((rows) => rows[0]!.id),
      db.db
        .insert(admins)
        .values({
          account,
          displayName: "直连管理员",
          isSuperAdmin: true,
          passwordHash,
        })
        .returning()
        .then((rows) => rows[0]!.id),
    ]);
    app = await buildApp(
      loadConfig({
        DATABASE_URL: url!,
        APP_ENV: "production",
        AUTH_TRANSPORT: "cookie",
        HTTP_IP_DIRECT: "true",
        PUBLIC_ORIGIN: origin,
        WEB_DIST: "tests/fixtures/web",
        WEB_CMS_DIST: "tests/fixtures/web-cms",
        WEB_CMS_PATH: "/admin",
        LOG_LEVEL: "silent",
      }),
      { logger: false },
    );
  });
  afterAll(async () => {
    await app?.close();
    if (spaceId) {
      await db.db.delete(files).where(eq(files.spaceId, spaceId));
      await db.db.delete(spaces).where(eq(spaces.id, spaceId));
    }
    if (userId) await db.db.delete(appUsers).where(eq(appUsers.id, userId));
    if (adminId) {
      await db.db.delete(auditLogs).where(eq(auditLogs.actorId, adminId));
      await db.db.delete(admins).where(eq(admins.id, adminId));
    }
    await db.close();
    if (previous === undefined) delete process.env.APP_PUBLIC_ORIGIN;
    else process.env.APP_PUBLIC_ORIGIN = previous;
  });
  test("前后台 HTTP Cookie 登录成功，身份隔离且 Cookie 保留 HttpOnly / SameSite", async () => {
    const user = await app.inject({
      method: "POST",
      url: "/api/app/auth/login",
      headers: { origin },
      payload: { account, password },
    });
    expect(user.statusCode).toBe(200);
    assertCookie(user.headers["set-cookie"]);
    userHeaders = headers(user);
    const admin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin },
      payload: { account, password },
    });
    expect(admin.statusCode).toBe(200);
    assertCookie(admin.headers["set-cookie"]);
    adminHeaders = headers(admin);
    expect(
      (await app.inject({ url: "/api/app/auth/me", headers: userHeaders }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/auth/me", headers: adminHeaders }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/app/auth/me", headers: adminHeaders }))
        .statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ url: "/api/auth/me", headers: userHeaders }))
        .statusCode,
    ).toBe(401);
  });
  test("缺失 CSRF、伪造来源和代理头不授予写权限，合法来源可以创建文件", async () => {
    for (const header of [
      { cookie: userHeaders.cookie, origin },
      { ...userHeaders, origin: "http://192.168.1.11:9811" },
      {
        ...userHeaders,
        origin: "https://docs.example.com",
        "x-forwarded-proto": "http",
        "x-forwarded-host": "192.168.1.10:9811",
      },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/app/spaces",
            headers: header,
            payload: { name: "不应创建" },
          })
        ).statusCode,
      ).toBe(403);
    const space = await app.inject({
      method: "POST",
      url: "/api/app/spaces",
      headers: userHeaders,
      payload: { name: "IP 直连空间" },
    });
    expect(space.statusCode).toBe(200);
    spaceId = space.json().id;
    const file = await app.inject({
      method: "POST",
      url: `/api/app/spaces/${spaceId}/files`,
      headers: userHeaders,
      payload: { kind: "doc", name: "直连文档", parentId: null },
    });
    expect(file.statusCode).toBe(200);
    fileId = file.json().id;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/app/files/${fileId}/collaboration-ticket`,
          headers: userHeaders,
          payload: { schemaVersion: 1 },
        })
      ).statusCode,
    ).toBe(200);
  });
  test("密码分享的访客 Cookie 在 HTTP 可用，来源校验不因直连关闭", async () => {
    const share = await app.inject({
      method: "PUT",
      url: `/api/app/files/${fileId}/share`,
      headers: userHeaders,
      payload: { visibility: "public", password: "guest-pass" },
    });
    expect(share.statusCode).toBe(200);
    const token = share.json().token;
    const unlock = (source: string) =>
      app.inject({
        method: "POST",
        url: `/api/public/shares/${token}/unlock`,
        headers: { origin: source },
        payload: { password: "guest-pass" },
      });
    expect((await unlock("http://192.168.1.11:9811")).statusCode).toBe(403);
    const guest = await unlock(origin);
    expect(guest.statusCode).toBe(200);
    assertCookie(guest.headers["set-cookie"]);
    const cookie = guest.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    expect(
      (
        await app.inject({
          url: `/api/public/shares/${token}/content`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
  });
});
