import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { Type } from "@sinclair/typebox";
import { buildApp } from "../../apps/app_server/src/app";
import { loadConfig } from "../../system/server/src/config/env";
import { createDatabase } from "../../system/server/src/database/client";
import {
  admins,
  sessions,
  roles,
  rolePermissions,
  auditLogs,
} from "../../system/server/src/database/schema/system";
import {
  hashPassword,
  hashToken,
} from "../../system/server/src/modules/auth/password";
import { adminPermissions as permissionGroups } from "../../config/permissions";
const url = process.env.AUTH_TEST_DATABASE_URL;
if (
  url &&
  new URL(url).pathname != "/mas_backend" &&
  !new URL(url).pathname.endsWith("_test")
)
  throw new Error(
    "Auth tests require a database ending in _test or the local mas_backend debug database",
  );
const suite = url ? describe : describe.skip;
suite("real database authentication and RBAC", () => {
  const database = createDatabase(url ?? "postgresql://localhost/unused_test");
  const prefix = `test_${Date.now()}`;
  const password = "Only-for-tests-123!";
  const config = (transport = "bearer") =>
    loadConfig({
      WEB_CMS_DIST: "tests/fixtures/web-cms",
      DATABASE_URL: url,
      APP_ENV: "staging",
      LOG_LEVEL: "silent",
      AUTH_TRANSPORT: transport,
    });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let rootId: string;
  let token: string;
  const createdRoles: string[] = [];
  const createdAdmins: string[] = [];
  const headers = () => ({ authorization: `Bearer ${token}` });
  const login = (account: string, pass = password) =>
    app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { account, password: pass },
    });
  beforeAll(async () => {
    const [root] = await database.db
      .insert(admins)
      .values({
        account: `${prefix}_root`,
        displayName: "Test root",
        passwordHash: await hashPassword(password),
        isSuperAdmin: true,
      })
      .returning();
    rootId = root!.id;
    createdAdmins.push(rootId);
    app = await buildApp(config(), { logger: false });
    app.get(
      "/api/test-super",
      {
        config: { auth: true, superAdmin: true },
        schema: { response: { 200: Type.Null() } },
      },
      async () => null,
    );
    app.get(
      "/api/test-all",
      {
        config: { auth: true, permissions: ["user:read", "role:read"] },
        schema: { response: { 200: Type.Null() } },
      },
      async () => null,
    );
    await app.ready();
    const result = await login(`${prefix}_root`);
    expect(result.statusCode).toBe(200);
    token = result.json().token;
  });
  afterAll(async () => {
    await app?.close();
    if (createdAdmins.length)
      await database.db.delete(admins).where(inArray(admins.id, createdAdmins));
    if (createdRoles.length)
      await database.db.delete(roles).where(inArray(roles.id, createdRoles));
    if (createdAdmins.length)
      await database.db
        .delete(auditLogs)
        .where(inArray(auditLogs.actorId, createdAdmins));
    await database.close();
  });
  test("bearer source only, hashes only, wrong password, unknown routes", async () => {
    expect((await app.inject("/api/auth/me")).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: "/api/auth/me",
          headers: { cookie: `mas_session=${token}` },
        })
      ).statusCode,
    ).toBe(401);
    const response = await app.inject({
      url: "/api/auth/me",
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().admin.isSuperAdmin).toBe(true);
    expect(response.json().admin.displayName).toBe("超级管理员");
    expect(response.json().admin.passwordHash).toBeUndefined();
    expect(response.body).not.toContain(token);
    const [stored] = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, hashToken(token)));
    expect(stored?.tokenHash).not.toBe(token);
    expect((await login(`${prefix}_root`, "incorrect")).statusCode).toBe(401);
  });
  test("super admin profile and roles are immutable even to itself", async () => {
    const [before] = await database.db
      .select()
      .from(admins)
      .where(eq(admins.id, rootId));
    const response = await app.inject({
      method: "PUT",
      url: `/api/admin/accounts/${rootId}`,
      headers: headers(),
      payload: { account: "renamed_root", displayName: "changed", roles: [] },
    });
    expect(response.statusCode).toBe(409);
    const [after] = await database.db
      .select()
      .from(admins)
      .where(eq(admins.id, rootId));
    expect(after).toEqual(before);
    for (const status of ["enabled", "disabled"]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/admin/accounts/status",
            headers: headers(),
            payload: { ids: [rootId], status },
          })
        ).statusCode,
      ).toBe(409);
    }
    const list = (
      await app.inject({
        url: `/api/admin/accounts?account=${prefix}_root`,
        headers: headers(),
      })
    ).json();
    expect(list.items[0].displayName).toBe("超级管理员");
    expect(list.items[0].roles).toEqual([]);
  });
  test("create role/account, no escalation, immediate revocation, disable and reset revoke sessions", async () => {
    const roleBody = {
      code: `${prefix}_reader`,
      name: `${prefix} reader`,
      description: "test",
      permissions: ["user:read"],
    };
    let response = await app.inject({
      method: "POST",
      url: "/api/admin/roles",
      headers: headers(),
      payload: roleBody,
    });
    expect(response.statusCode).toBe(200);
    const role = (
      await app.inject({
        url: `/api/admin/roles?name=${prefix}`,
        headers: headers(),
      })
    ).json().items[0];
    createdRoles.push(role.id);
    const accountBody = {
      account: `${prefix}_user`,
      displayName: "Test reader",
      password,
      roles: [role.id],
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/accounts",
          headers: headers(),
          payload: { ...accountBody, isSuperAdmin: true },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/accounts",
          headers: headers(),
          payload: accountBody,
        })
      ).statusCode,
    ).toBe(200);
    const user = (
      await app.inject({
        url: `/api/admin/accounts?account=${accountBody.account}`,
        headers: headers(),
      })
    ).json().items[0];
    createdAdmins.push(user.id);
    let userToken = (await login(accountBody.account)).json().token;
    const userHeaders = () => ({ authorization: `Bearer ${userToken}` });
    expect(
      (await app.inject({ url: "/api/admin/accounts", headers: userHeaders() }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/admin/roles", headers: userHeaders() }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: "/api/test-super", headers: userHeaders() }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: "/api/test-all", headers: userHeaders() }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/admin/roles/${role.id}`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/admin/roles/${role.id}`,
          headers: headers(),
          payload: { ...roleBody, permissions: [] },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/admin/accounts", headers: userHeaders() }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/accounts/status",
          headers: headers(),
          payload: { ids: [user.id], status: "disabled" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/auth/me", headers: userHeaders() }))
        .statusCode,
    ).toBe(401);
    expect((await login(accountBody.account)).statusCode).toBe(401);
    await app.inject({
      method: "POST",
      url: "/api/admin/accounts/status",
      headers: headers(),
      payload: { ids: [user.id], status: "enabled" },
    });
    userToken = (await login(accountBody.account)).json().token;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/admin/accounts/${user.id}/password`,
          headers: headers(),
          payload: { password: "Changed-for-tests-456!" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/auth/me", headers: userHeaders() }))
        .statusCode,
    ).toBe(401);
    const audits = await database.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.targetId, user.id));
    expect(audits.some((row) => row.action === "admin.reset-password")).toBe(
      true,
    );
    expect(JSON.stringify(audits)).not.toContain("Changed-for-tests");
    expect(JSON.stringify(audits)).not.toContain(password);
  });
  test("multi-role union, delegated grant boundaries and stale permissions never grant access", async () => {
    const roleBodies = [
      {
        code: `${prefix}_a`,
        name: `${prefix} a`,
        description: "",
        permissions: ["user:read", "user:update", "role:update"],
      },
      {
        code: `${prefix}_b`,
        name: `${prefix} b`,
        description: "",
        permissions: ["role:read"],
      },
    ];
    const roleIds: string[] = [];
    for (const body of roleBodies) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/admin/roles",
            headers: headers(),
            payload: body,
          })
        ).statusCode,
      ).toBe(200);
      const role = (
        await app.inject({
          url: `/api/admin/roles?name=${encodeURIComponent(body.name)}`,
          headers: headers(),
        })
      ).json().items[0];
      roleIds.push(role.id);
      createdRoles.push(role.id);
    }
    const body = {
      account: `${prefix}_delegate`,
      displayName: "delegate",
      password,
      roles: roleIds,
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/accounts",
          headers: headers(),
          payload: body,
        })
      ).statusCode,
    ).toBe(200);
    const row = (
      await app.inject({
        url: `/api/admin/accounts?account=${body.account}`,
        headers: headers(),
      })
    ).json().items[0];
    createdAdmins.push(row.id);
    const delegateToken = (await login(body.account)).json().token;
    const delegated = { authorization: `Bearer ${delegateToken}` };
    // 模拟从代码目录移除后残留的授权；不能被鉴权或角色列表认可。
    await database.db.insert(rolePermissions).values({
      roleId: roleIds[0]!,
      permissionCode: "removed:permission",
    });
    const identity = await app.inject({
      url: "/api/auth/me",
      headers: delegated,
    });
    expect(identity.statusCode).toBe(200);
    expect(identity.json().admin.permissions).not.toContain(
      "removed:permission",
    );
    const catalog = await app.inject({
      url: "/api/admin/permissions",
      headers: delegated,
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().groups).toEqual(permissionGroups);

    expect(
      (await app.inject({ url: "/api/test-all", headers: delegated }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/test-all", headers: delegated }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/admin/accounts/${rootId}`,
          headers: delegated,
          payload: {
            account: `${prefix}_root`,
            displayName: "hijack",
            roles: [],
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/admin/roles/${roleIds[0]}`,
          headers: delegated,
          payload: { ...roleBodies[0], permissions: ["audit:read"] },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/admin/roles/${roleIds[0]}`,
          headers: headers(),
          payload: { ...roleBodies[0], permissions: ["not:real"] },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/accounts",
          headers: headers(),
          payload: body,
        })
      ).statusCode,
    ).toBe(409);
    const unchanged = (
      await app.inject({
        url: `/api/admin/roles?name=${encodeURIComponent(roleBodies[0]!.name)}`,
        headers: headers(),
      })
    ).json().items[0];
    expect(unchanged.permissions.sort()).toEqual(
      roleBodies[0]!.permissions.sort(),
    );
  });
  test("bulk status change rolls back data, session revocation and audit together", async () => {
    const id = createdAdmins[1]!;
    const [before] = await database.db
      .select()
      .from(admins)
      .where(eq(admins.id, id));
    const auditsBefore = await database.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.targetId, id));
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/accounts/status",
      headers: headers(),
      payload: { ids: [id, crypto.randomUUID()], status: "disabled" },
    });
    expect(response.statusCode).toBe(404);
    const [after] = await database.db
      .select()
      .from(admins)
      .where(eq(admins.id, id));
    expect(after!.status).toBe(before!.status);
    expect(
      (
        await database.db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.targetId, id))
      ).length,
    ).toBe(auditsBefore.length);
    const role = createdRoles[0]!;
    const filtered = await app.inject({
      url: `/api/admin/accounts?roles=${role}`,
      headers: headers(),
    });
    expect(filtered.statusCode).toBe(200);
    expect(
      filtered
        .json()
        .items.every((row: { roles: string[] }) => row.roles.includes(role)),
    ).toBe(true);
    expect(
      (
        await app.inject({
          url: "/api/admin/accounts?roles=invalid",
          headers: headers(),
        })
      ).statusCode,
    ).toBe(400);
  });
  test("runtime failures and role changes are queryable without secrets", async () => {
    const failure = await app.inject({
      url: "/api/auth/me",
      headers: {
        authorization: "Bearer deliberately-secret",
        cookie: "mas_session=do-not-store",
      },
    });
    await Bun.sleep(1150);
    const logs = await app.inject({
      url: `/api/admin/logs?requestId=${failure.headers["x-request-id"]}`,
      headers: headers(),
    });
    expect(logs.statusCode).toBe(200);
    expect(logs.json().items[0].statusCode).toBe(401);
    expect(logs.body).not.toContain("deliberately-secret");
    expect(logs.body).not.toContain("do-not-store");
    const audit = await app.inject({
      url: `/api/admin/audit?action=role.update&actor=${prefix}_root`,
      headers: headers(),
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().items.length).toBeGreaterThan(0);
    expect(audit.json().items[0].after).toHaveProperty("permissions");
    expect(
      (
        await app.inject({
          url: "/api/admin/logs?pageSize=10000",
          headers: headers(),
        })
      ).statusCode,
    ).toBe(400);
  });
  test("management and log lists clamp overflow pages and expose pagination metadata", async () => {
    for (const path of ["accounts", "roles", "logs", "audit"]) {
      const response = await app.inject({
        url: `/api/admin/${path}?page=999999&pageSize=1`,
        headers: headers(),
      });
      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.pageSize).toBe(1);
      expect(data.page).toBe(Math.max(1, data.total));
      expect(data.items.length).toBe(data.total ? 1 : 0);
    }
  });
  test("expiry and logout revoke sessions", async () => {
    const separate = (await login(`${prefix}_root`)).json().token;
    await database.db
      .update(sessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(sessions.tokenHash, hashToken(separate)));
    expect(
      (
        await app.inject({
          url: "/api/auth/me",
          headers: { authorization: `Bearer ${separate}` },
        })
      ).statusCode,
    ).toBe(401);
    const logoutToken = (await login(`${prefix}_root`)).json().token;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { authorization: `Bearer ${logoutToken}` },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: "/api/auth/me",
          headers: { authorization: `Bearer ${logoutToken}` },
        })
      ).statusCode,
    ).toBe(401);
  });
  test("cookie CSRF and transport changes cannot revive old sessions", async () => {
    await app.close();
    app = await buildApp(config("cookie"), { logger: false });
    await app.ready();
    let result = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://127.0.0.1:9811" },
      payload: { account: `${prefix}_root`, password },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().token).toBeUndefined();
    const cookie = String(result.headers["set-cookie"]).split(";")[0]!;
    expect(String(result.headers["set-cookie"])).toContain("HttpOnly");
    expect(
      (
        await app.inject({
          url: "/api/auth/me",
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ url: "/api/auth/me", headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { cookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: {
            cookie,
            origin: "https://evil.example",
            "x-csrf-token": result.json().csrfToken,
          },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: {
            cookie,
            origin: "http://127.0.0.1:9811",
            "x-csrf-token": result.json().csrfToken,
          },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
    app = await buildApp(config(), { logger: false });
    await app.ready();
    expect(
      (await app.inject({ url: "/api/auth/me", headers: headers() }))
        .statusCode,
    ).toBe(401);
  });
  test("security headers, request size and login rate limits apply", async () => {
    const response = await app.inject({
      url: "/api/auth/config",
      headers: { origin: "https://untrusted.example" },
    });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toContain(
      "default-src 'self'",
    );
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { account: "invalid", password: "a".repeat(1100000) },
        })
      ).statusCode,
    ).toBe(413);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++)
      statuses.push(
        (
          await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account: "invalid", password: "wrong" },
          })
        ).statusCode,
      );
    expect(statuses).toContain(401);
    expect(statuses.at(-1)).toBe(429);
  });
});
