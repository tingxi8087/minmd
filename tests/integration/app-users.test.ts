import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, like } from "drizzle-orm";
import { Type } from "@sinclair/typebox";
import { buildApp } from "../../apps/app_server/src/app";
import {
  appUsers,
  appUserRoles,
} from "../../apps/app_server/src/database/schema/users";
import {
  admins,
  adminRoles,
  roles,
  rolePermissions,
  auditLogs,
} from "../../system/server/src/database/schema/system";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import { hashPassword } from "../../system/server/src/modules/auth/password";
import { appPermissions } from "../../config/permissions";
const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw new Error("App user tests require an isolated _test database");
const suite = url ? describe : describe.skip;
suite("front and back office identity boundaries", () => {
  const db = createDatabase(url ?? "postgresql://localhost/unused_test");
  const prefix = `appcheck_${Date.now()}`;
  const password = "App-users-test-123!";
  const config = loadConfig({
    DATABASE_URL: url ?? "postgresql://localhost/unused_test",
    APP_ENV: "staging",
    WEB_CMS_DIST: "tests/fixtures/web-cms",
    LOG_LEVEL: "silent",
    AUTH_TRANSPORT: "bearer",
    PUBLIC_ORIGIN: "http://127.0.0.1:5173",
  });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminToken: string;
  let rootId: string;
  let userId: string;
  let userToken: string;
  let appRoleId: string;
  let adminRoleId: string;
  const adminHeaders = () => ({ authorization: `Bearer ${adminToken}` });
  const userHeaders = () => ({ authorization: `Bearer ${userToken}` });
  const login = async (account = `${prefix}_a`) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/app/auth/login",
      payload: { account, password },
    });
    expect(res.statusCode).toBe(200);
    return res.json().token as string;
  };
  const input = (account: string) => ({
    account,
    nickname: "测试用户",
    avatar: "",
    metadata: { theme: "dark", tags: ["one"] },
    roles: [] as string[],
  });
  beforeAll(async () => {
    // 在测试目录注入真实前台业务权限，验证非空目录的授权边界。
    appPermissions.push({
      code: "fixture",
      name: "测试业务",
      permissions: [
        {
          code: "fixture:read",
          name: "读取测试业务",
          description: "仅用于测试",
          write: false,
        },
      ],
    });
    const [root] = await db.db
      .insert(admins)
      .values({
        account: `${prefix}_root`,
        displayName: "Fixture",
        passwordHash: await hashPassword(password),
        isSuperAdmin: true,
      })
      .returning();
    rootId = root!.id;
    app = await buildApp(config, { logger: false });
    app.get(
      "/api/app/fixture",
      {
        config: { auth: true, authScope: "app", permissions: ["fixture:read"] },
        schema: { response: { 200: Type.Object({ ok: Type.Boolean() }) } },
      },
      async () => ({ ok: true }),
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { account: root!.account, password },
    });
    expect(res.statusCode).toBe(200);
    adminToken = res.json().token;
  });
  afterAll(async () => {
    await app?.close();
    appPermissions.splice(
      appPermissions.findIndex((g) => g.code === "fixture"),
      1,
    );
    await db.db.delete(appUsers).where(like(appUsers.account, `${prefix}%`));
    await db.db.delete(admins).where(like(admins.account, `${prefix}%`));
    await db.db.delete(roles).where(like(roles.code, `${prefix}%`));
    await db.db.delete(auditLogs).where(eq(auditLogs.actorId, rootId));
    await db.close();
  });
  test("registration rejects privilege fields, normalizes account and stores a hash", async () => {
    for (const extra of [
      { roles: [] },
      { status: "enabled" },
      { metadata: {} },
      { isSuperAdmin: true },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/app/auth/register",
            payload: { account: `${prefix}_a`, password, ...extra },
          })
        ).statusCode,
      ).toBe(400);
    }
    const res = await app.inject({
      method: "POST",
      url: "/api/app/auth/register",
      payload: {
        account: `${prefix}_a`.toUpperCase(),
        password,
        nickname: "用户 A",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/app/auth/register",
          payload: { account: `${prefix}_a`, password },
        })
      ).statusCode,
    ).toBe(409);
    const [user] = await db.db
      .select()
      .from(appUsers)
      .where(eq(appUsers.account, `${prefix}_a`));
    userId = user!.id;
    expect(user!.metadata).toEqual({});
    expect(user!.passwordHash).not.toBe(password);
    expect(await Bun.password.verify(password, user!.passwordHash)).toBe(true);
    expect(
      await db.db
        .select()
        .from(appUserRoles)
        .where(eq(appUserRoles.userId, userId)),
    ).toHaveLength(0);
    userToken = await login();
  });
  test("tokens cannot cross identities; own profile cannot set authorization or metadata", async () => {
    expect(
      (await app.inject({ url: "/api/auth/me", headers: userHeaders() }))
        .statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ url: "/api/app/auth/me", headers: adminHeaders() }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: "/api/admin/app-users",
          headers: userHeaders(),
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ url: "/api/app/fixture", headers: userHeaders() }))
        .statusCode,
    ).toBe(403);
    const me = await app.inject({
      url: "/api/app/auth/me",
      headers: userHeaders(),
    });
    expect(me.json().user.id).toBe(userId);
    expect(me.body).not.toContain("passwordHash");
    for (const extra of [
      { id: rootId },
      { metadata: { isSuperAdmin: true } },
      { roles: [rootId] },
      { status: "disabled" },
    ])
      expect(
        (
          await app.inject({
            method: "PUT",
            url: "/api/app/auth/me",
            headers: userHeaders(),
            payload: { nickname: "changed", avatar: "", ...extra },
          })
        ).statusCode,
      ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/app/auth/me",
          headers: userHeaders(),
          payload: { nickname: "用户 A 修改", avatar: "/public/avatar.png" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({ url: "/api/app/auth/me", headers: userHeaders() })
      ).json().user.nickname,
    ).toBe("用户 A 修改");
  });
  test("role scope filters permissions, assignments, options, members and cannot change", async () => {
    const roleInput = (scope: "app" | "admin", permissions: string[]) => ({
      scope,
      code: `${prefix}_${scope}`,
      name: `${prefix}_${scope}`,
      description: "测试",
      permissions,
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/roles",
          headers: adminHeaders(),
          payload: roleInput("app", ["user:read"]),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/roles",
          headers: adminHeaders(),
          payload: roleInput("admin", ["fixture:read"]),
        })
      ).statusCode,
    ).toBe(400);
    for (const scope of ["app", "admin"] as const)
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/admin/roles",
            headers: adminHeaders(),
            payload: roleInput(
              scope,
              scope === "app" ? ["fixture:read"] : ["user:read"],
            ),
          })
        ).statusCode,
      ).toBe(200);
    appRoleId = (
      await db.db
        .select()
        .from(roles)
        .where(eq(roles.code, `${prefix}_app`))
    )[0]!.id;
    adminRoleId = (
      await db.db
        .select()
        .from(roles)
        .where(eq(roles.code, `${prefix}_admin`))
    )[0]!.id;
    const appOptions = (
      await app.inject({
        url: "/api/admin/role-options?scope=app",
        headers: adminHeaders(),
      })
    ).json().items;
    expect(appOptions.some((r: any) => r.value === appRoleId)).toBe(true);
    expect(appOptions.some((r: any) => r.value === adminRoleId)).toBe(false);
    expect(
      (
        await app.inject({
          url: "/api/admin/permissions?scope=app",
          headers: adminHeaders(),
        })
      ).json().groups,
    ).toEqual(appPermissions);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/admin/roles/${appRoleId}`,
          headers: adminHeaders(),
          payload: { ...roleInput("app", []), scope: "admin" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/accounts",
          headers: adminHeaders(),
          payload: {
            account: `${prefix}_invalid`,
            displayName: "Invalid",
            password,
            roles: [appRoleId],
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/admin/app-users/${userId}`,
          headers: adminHeaders(),
          payload: { ...input(`${prefix}_a`), roles: [adminRoleId] },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/admin/app-users/${userId}`,
          headers: adminHeaders(),
          payload: { ...input(`${prefix}_a`), roles: [appRoleId] },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/app/fixture", headers: userHeaders() }))
        .statusCode,
    ).toBe(200);
    const list = await app.inject({
      url: `/api/admin/roles?scope=app&name=${prefix}`,
      headers: adminHeaders(),
    });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0].members).toBe(1);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/admin/roles/${appRoleId}`,
          headers: adminHeaders(),
        })
      ).statusCode,
    ).toBe(409);
    // 即使有人直接在关联表写入后台权限，前台鉴权也不会授予它。
    await db.db
      .insert(rolePermissions)
      .values({ roleId: appRoleId, permissionCode: "user:read" });
    expect(
      (
        await app.inject({ url: "/api/app/auth/me", headers: userHeaders() })
      ).json().permissions,
    ).toEqual(["fixture:read"]);
    await db.db
      .delete(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, appRoleId),
          eq(rolePermissions.permissionCode, "user:read"),
        ),
      );
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/admin/roles/${appRoleId}`,
          headers: adminHeaders(),
          payload: roleInput("app", []),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/app/fixture", headers: userHeaders() }))
        .statusCode,
    ).toBe(403);
  });
  test("management persists JSON, validates it, bounds pages and enforces individual permissions", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/app-users",
          headers: adminHeaders(),
          payload: { ...input(`${prefix}_b`), password },
        })
      ).statusCode,
    ).toBe(200);
    for (const metadata of [[], null, "bad"])
      expect(
        (
          await app.inject({
            method: "PUT",
            url: `/api/admin/app-users/${userId}`,
            headers: adminHeaders(),
            payload: { ...input(`${prefix}_a`), metadata },
          })
        ).statusCode,
      ).toBe(400);
    const details = await app.inject({
      url: `/api/admin/app-users/${userId}`,
      headers: adminHeaders(),
    });
    expect(details.json().metadata).toEqual({ theme: "dark", tags: ["one"] });
    expect(details.body).not.toContain("password");
    expect(
      (
        await app.inject({ url: "/api/app/auth/me", headers: userHeaders() })
      ).json().user.metadata,
    ).toEqual(details.json().metadata);
    const list = await app.inject({
      url: `/api/admin/app-users?keyword=${prefix}&pageSize=1&page=999`,
      headers: adminHeaders(),
    });
    expect(list.json().total).toBe(2);
    expect(list.json().page).toBe(2);
    expect(list.json().items).toHaveLength(1);
    const [limited] = await db.db
      .insert(admins)
      .values({
        account: `${prefix}_limited`,
        displayName: "只读",
        passwordHash: await hashPassword(password),
      })
      .returning();
    await db.db
      .insert(adminRoles)
      .values({ adminId: limited!.id, roleId: adminRoleId });
    await db.db
      .insert(rolePermissions)
      .values({ roleId: adminRoleId, permissionCode: "app-user:read" });
    const token = (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { account: limited!.account, password },
      })
    ).json().token;
    const headers = { authorization: `Bearer ${token}` };
    expect(
      (await app.inject({ url: "/api/admin/app-users", headers })).statusCode,
    ).toBe(200);
    for (const action of ["status", "password", "revoke"])
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/admin/app-users/${userId}/${action}`,
            headers,
            payload:
              action === "status"
                ? { status: "disabled" }
                : action === "password"
                  ? { password }
                  : {},
          })
        ).statusCode,
      ).toBe(403);
  });
  test("disable, reset, force logout, password change and logout revoke sessions", async () => {
    for (const action of ["revoke", "status", "password"]) {
      userToken = await login();
      const secondToken = await login();
      const payload =
        action === "status"
          ? { status: "disabled" }
          : action === "password"
            ? { password }
            : {};
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/admin/app-users/${userId}/${action}`,
            headers: adminHeaders(),
            payload,
          })
        ).statusCode,
      ).toBe(200);
      for (const token of [userToken, secondToken])
        expect(
          (
            await app.inject({
              url: "/api/app/auth/me",
              headers: { authorization: `Bearer ${token}` },
            })
          ).statusCode,
        ).toBe(401);
      if (action === "status") {
        expect(
          (
            await app.inject({
              method: "POST",
              url: "/api/app/auth/login",
              payload: { account: `${prefix}_a`, password },
            })
          ).statusCode,
        ).toBe(401);
        expect(
          (
            await app.inject({
              method: "POST",
              url: `/api/admin/app-users/${userId}/status`,
              headers: adminHeaders(),
              payload: { status: "enabled" },
            })
          ).statusCode,
        ).toBe(200);
        expect(
          (
            await app.inject({
              url: "/api/app/auth/me",
              headers: userHeaders(),
            })
          ).statusCode,
        ).toBe(401);
      }
    }
    // 重置限流测试 IP，避免这组正常登录触发登录防爆破。
    const loginAgain = await app.inject({
      method: "POST",
      url: "/api/app/auth/login",
      remoteAddress: "127.0.0.2",
      payload: { account: `${prefix}_a`, password },
    });
    expect(loginAgain.statusCode).toBe(200);
    userToken = loginAgain.json().token;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/app/auth/password",
          headers: userHeaders(),
          payload: { oldPassword: "wrong", password },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/app/auth/password",
          headers: userHeaders(),
          payload: { oldPassword: password, password },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/app/auth/me", headers: userHeaders() }))
        .statusCode,
    ).toBe(401);
    const fresh = await app.inject({
      method: "POST",
      url: "/api/app/auth/login",
      remoteAddress: "127.0.0.3",
      payload: { account: `${prefix}_a`, password },
    });
    userToken = fresh.json().token;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/app/auth/logout",
          headers: userHeaders(),
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/app/auth/me", headers: userHeaders() }))
        .statusCode,
    ).toBe(401);
    const events = await db.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.targetId, userId));
    expect(
      events
        .filter((r) => r.action.startsWith("app-user."))
        .map((r) => r.action)
        .sort(),
    ).toEqual(
      [
        "app-user.update",
        "app-user.revoke",
        "app-user.status",
        "app-user.status",
        "app-user.password",
      ].sort(),
    );
    expect(JSON.stringify(events)).not.toContain(password);
  });
  test("cookie mode uses its own cookie, CSRF and permanently revokes the other transport", async () => {
    const bearer = await app.inject({
      method: "POST",
      url: "/api/app/auth/login",
      remoteAddress: "127.0.0.4",
      payload: { account: `${prefix}_a`, password },
    });
    const cookieApp = await buildApp(
      { ...config, AUTH_TRANSPORT: "cookie" },
      { logger: false },
    );
    try {
      const res = await cookieApp.inject({
        method: "POST",
        url: "/api/app/auth/login",
        payload: { account: `${prefix}_a`, password },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().token).toBeUndefined();
      const cookie = String(res.headers["set-cookie"]).split(";")[0];
      expect(cookie).toStartWith("mas_app_session=");
      expect(String(res.headers["set-cookie"])).toContain("HttpOnly");
      expect(
        (await cookieApp.inject({ url: "/api/auth/me", headers: { cookie } }))
          .statusCode,
      ).toBe(401);
      expect(
        (
          await cookieApp.inject({
            method: "PUT",
            url: "/api/app/auth/me",
            headers: { cookie },
            payload: { nickname: "Cookie", avatar: "" },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await cookieApp.inject({
            method: "PUT",
            url: "/api/app/auth/me",
            headers: {
              cookie,
              origin: config.PUBLIC_ORIGIN,
              "x-csrf-token": res.json().csrfToken,
            },
            payload: { nickname: "Cookie", avatar: "" },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            url: "/api/app/auth/me",
            headers: { authorization: `Bearer ${bearer.json().token}` },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await cookieApp.inject({
            method: "POST",
            url: "/api/app/auth/logout",
            headers: {
              cookie,
              origin: config.PUBLIC_ORIGIN,
              "x-csrf-token": res.json().csrfToken,
            },
            payload: {},
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await cookieApp.inject({
            url: "/api/app/auth/me",
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await cookieApp.close();
    }
  });
});
