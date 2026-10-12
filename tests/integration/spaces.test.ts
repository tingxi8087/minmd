import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, like } from "drizzle-orm";
import { buildApp } from "../../apps/app_server/src/app";
import { appUsers } from "../../apps/app_server/src/database/schema/users";
import { spaces } from "../../apps/app_server/src/database/schema/spaces";
import {
  admins,
  roles,
  adminRoles,
  rolePermissions,
  auditLogs,
} from "../../system/server/src/database/schema/system";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import { hashPassword } from "../../system/server/src/modules/auth/password";
const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw new Error("空间测试只能使用独立 _test 数据库");
const suite = url ? describe : describe.skip;
suite("空间身份、成员与负责人事务边界", () => {
  const db = createDatabase(url ?? "postgresql://localhost/unused_test");
  const prefix = `spacecheck_${Date.now()}`;
  const password = "Space-test-secret-123!";
  let app: Awaited<ReturnType<typeof buildApp>>;
  let a: string, b: string, outsider: string, admin: string;
  let aid: string, bid: string, rootId: string, spaceId: string;
  const headers = (token: string) => ({ authorization: `Bearer ${token}` });
  beforeAll(async () => {
    const hash = await hashPassword(password);
    const users = await db.db
      .insert(appUsers)
      .values(
        ["a", "b", "outside"].map((suffix) => ({
          account: `${prefix}_${suffix}`,
          passwordHash: hash,
          nickname: suffix,
        })),
      )
      .returning();
    aid = users[0]!.id;
    bid = users[1]!.id;
    const [root] = await db.db
      .insert(admins)
      .values({
        account: `${prefix}_root`,
        displayName: "空间测试",
        passwordHash: hash,
        isSuperAdmin: true,
      })
      .returning();
    rootId = root!.id;
    app = await buildApp(
      loadConfig({
        DATABASE_URL: url!,
        APP_ENV: "staging",
        WEB_CMS_DIST: "tests/fixtures/web-cms",
        LOG_LEVEL: "silent",
        AUTH_TRANSPORT: "bearer",
      }),
      { logger: false },
    );
    const login = async (account: string, path = "/api/app/auth/login") => {
      const result = await app.inject({
        method: "POST",
        url: path,
        payload: { account, password },
      });
      expect(result.statusCode).toBe(200);
      return result.json().token as string;
    };
    a = await login(`${prefix}_a`);
    b = await login(`${prefix}_b`);
    outsider = await login(`${prefix}_outside`);
    admin = await login(`${prefix}_root`, "/api/auth/login");
  });
  afterAll(async () => {
    await app?.close();
    await db.db.delete(spaces).where(like(spaces.name, `${prefix}%`));
    await db.db.delete(appUsers).where(like(appUsers.account, `${prefix}%`));
    await db.db.delete(auditLogs).where(eq(auditLogs.actorId, rootId));
    await db.db.delete(admins).where(eq(admins.id, rootId));
    await db.close();
  });
  test("创建仅绑定当前身份且响应没有敏感账号字段", async () => {
    const denied = await app.inject({
      method: "POST",
      url: "/api/app/spaces",
      headers: headers(a),
      payload: { name: prefix, ownerId: bid },
    });
    expect(denied.statusCode).toBe(400);
    const created = await app.inject({
      method: "POST",
      url: "/api/app/spaces",
      headers: headers(a),
      payload: { name: prefix },
    });
    expect(created.statusCode).toBe(200);
    spaceId = created.json().id;
    expect(created.json().ownerId).toBe(aid);
    const listed = await app.inject({
      url: "/api/app/spaces",
      headers: headers(outsider),
    });
    expect(
      listed.json().items.some((item: { id: string }) => item.id === spaceId),
    ).toBe(false);
    expect(
      (
        await app.inject({
          url: `/api/app/spaces/${spaceId}`,
          headers: headers(outsider),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: `/api/app/spaces/${spaceId}`,
          headers: headers(admin),
        })
      ).statusCode,
    ).toBe(401);
  });
  test("成员分配与搜索仅负责人可做，响应最小资料", async () => {
    const lookup = await app.inject({
      url: `/api/app/spaces/${spaceId}/accounts?q=${prefix}_b`,
      headers: headers(a),
    });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().items[0].id).toBe(bid);
    expect(Object.keys(lookup.json().items[0]).sort()).toEqual([
      "account",
      "avatar",
      "id",
      "nickname",
    ]);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/app/spaces/${spaceId}/members`,
          headers: headers(a),
          payload: { userId: bid },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/app/spaces/${spaceId}`,
          headers: headers(b),
          payload: { name: "偷改" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: `/api/app/spaces/${spaceId}/accounts?q=${prefix}_a`,
          headers: headers(b),
        })
      ).statusCode,
    ).toBe(403);
    const members = await app.inject({
      url: `/api/app/spaces/${spaceId}/members?page=999&pageSize=1`,
      headers: headers(b),
    });
    expect(members.json().page).toBe(2);
    expect(members.json().total).toBe(2);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/app/spaces/${spaceId}/members/${aid}`,
          headers: headers(a),
        })
      ).statusCode,
    ).toBe(409);
  });
  test("普通后台角色空间读写权限分离，不赋予私有正文访问", async () => {
    for (const permission of ["space:read", "space:update"]) {
      const [role] = await db.db
        .insert(roles)
        .values({
          code: `${prefix}_${permission.replace(":", "_")}`,
          name: `${prefix}_${permission}`,
        })
        .returning();
      const [account] = await db.db
        .insert(admins)
        .values({
          account: `${prefix}_${permission.replace(":", "_")}`,
          displayName: permission,
          passwordHash: await hashPassword(password),
        })
        .returning();
      try {
        await db.db
          .insert(rolePermissions)
          .values({ roleId: role!.id, permissionCode: permission });
        await db.db
          .insert(adminRoles)
          .values({ adminId: account!.id, roleId: role!.id });
        const login = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { account: account!.account, password },
        });
        expect(login.statusCode).toBe(200);
        const identity = headers(login.json().token);
        expect(
          (
            await app.inject({
              url: `/api/admin/spaces/${spaceId}`,
              headers: identity,
            })
          ).statusCode,
        ).toBe(permission === "space:read" ? 200 : 403);
        expect(
          (
            await app.inject({
              method: "PATCH",
              url: `/api/admin/spaces/${spaceId}`,
              headers: identity,
              payload: { description: permission },
            })
          ).statusCode,
        ).toBe(permission === "space:update" ? 200 : 403);
        expect(
          (
            await app.inject({
              url: `/api/app/spaces/${spaceId}`,
              headers: identity,
            })
          ).statusCode,
        ).toBe(401);
        const file = await app.inject({
          method: "POST",
          url: `/api/app/spaces/${spaceId}/files`,
          headers: headers(a),
          payload: { kind: "doc", name: "后台不可读正文" },
        });
        expect(file.statusCode).toBe(200);
        expect(
          (
            await app.inject({
              url: `/api/app/files/${file.json().id}/content`,
              headers: identity,
            })
          ).statusCode,
        ).toBe(401);
        await db.db
          .delete(
            (await import("../../apps/app_server/src/database/schema/files"))
              .files,
          )
          .where(
            eq(
              (await import("../../apps/app_server/src/database/schema/files"))
                .files.id,
              file.json().id,
            ),
          );
      } finally {
        await db.db.delete(auditLogs).where(eq(auditLogs.actorId, account!.id));
        await db.db.delete(admins).where(eq(admins.id, account!.id));
        await db.db.delete(roles).where(eq(roles.id, role!.id));
      }
    }
  });
  test("并发转移与移除不能制造无成员负责人", async () => {
    const [transfer, remove] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/app/spaces/${spaceId}/transfer-owner`,
        headers: headers(a),
        payload: { userId: bid },
      }),
      app.inject({
        method: "DELETE",
        url: `/api/app/spaces/${spaceId}/members/${bid}`,
        headers: headers(a),
      }),
    ]);
    expect([200, 400]).toContain(transfer.statusCode);
    expect([200, 403]).toContain(remove.statusCode);
    const current = await app.inject({
      url: `/api/app/spaces/${spaceId}`,
      headers: headers(a),
    });
    const members = await app.inject({
      url: `/api/app/spaces/${spaceId}/members`,
      headers: headers(a),
    });
    expect(
      members
        .json()
        .items.some(
          (member: { id: string }) => member.id === current.json().ownerId,
        ),
    ).toBe(true);
    // 后台管理通过独立权限入口恢复确定状态，不获得正文权限。
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/admin/spaces/${spaceId}/members`,
          headers: headers(admin),
          payload: { userId: bid },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/admin/spaces/${spaceId}/transfer-owner`,
          headers: headers(admin),
          payload: { userId: aid },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/app/spaces/${spaceId}/members/${bid}`,
          headers: headers(a),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: `/api/app/spaces/${spaceId}/members`,
          headers: headers(b),
        })
      ).statusCode,
    ).toBe(403);
    const audit = await db.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actorId, rootId));
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });
});
