import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray, like } from "drizzle-orm";
import { buildApp } from "../../apps/app_server/src/app";
import { appUsers } from "../../apps/app_server/src/database/schema/users";
import {
  files,
  fileFavorites,
  fileVisits,
} from "../../apps/app_server/src/database/schema/files";
import { spaces } from "../../apps/app_server/src/database/schema/spaces";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import { hashPassword } from "../../system/server/src/modules/auth/password";
import { loadMinmdConfig } from "../../config/minmd";
import {
  fileContents,
  fileVersions,
  documentUpdates,
} from "../../apps/app_server/src/database/schema/contents";
import {
  fileShares,
  shareGuestSessions,
} from "../../apps/app_server/src/database/schema/shares";
const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw new Error("文件测试只能使用独立 _test 数据库");
const suite = url ? describe : describe.skip;
suite("文件树、回收站与账号资源边界", () => {
  const db = createDatabase(url ?? "postgresql://localhost/unused_test");
  const prefix = `filecheck_${Date.now()}`;
  const password = "File-test-password-123!";
  let app: Awaited<ReturnType<typeof buildApp>>;
  let a: string, b: string, outside: string;
  let aid: string, bid: string;
  let spaceId: string, otherSpace: string;
  const headers = (token = a) => ({ authorization: `Bearer ${token}` });
  const create = async (
    kind: string,
    name: string,
    parentId: string | null = null,
    space = spaceId,
  ) => {
    const r = await app.inject({
      method: "POST",
      url: `/api/app/spaces/${space}/files`,
      headers: headers(),
      payload: { kind, name, parentId },
    });
    expect(r.statusCode).toBe(200);
    return r.json() as {
      id: string;
      metadataRevision: number;
      parentId: string | null;
      deletedAt: string | null;
    };
  };
  const current = async (id: string) => {
    const r = await app.inject({
      url: `/api/app/files/${id}`,
      headers: headers(),
    });
    expect(r.statusCode).toBe(200);
    return r.json() as {
      id: string;
      metadataRevision: number;
      parentId: string | null;
      deletedAt: string | null;
    };
  };
  const move = async (
    id: string,
    parentId: string | null,
    beforeId?: string,
  ) => {
    const file = await current(id);
    return app.inject({
      method: "POST",
      url: `/api/app/files/${id}/move`,
      headers: headers(),
      payload: {
        parentId,
        expectedMetadataRevision: file.metadataRevision,
        ...(beforeId ? { beforeId } : {}),
      },
    });
  };
  const remove = (id: string, token = a) =>
    app.inject({
      method: "DELETE",
      url: `/api/app/files/${id}`,
      headers: headers(token),
    });
  const restore = (id: string, payload: { parentId?: string | null } = {}) =>
    app.inject({
      method: "POST",
      url: `/api/app/files/${id}/restore`,
      headers: headers(),
      payload,
    });
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
    app = await buildApp(
      loadConfig({
        DATABASE_URL: url!,
        APP_ENV: "staging",
        WEB_CMS_DIST: "tests/fixtures/web-cms",
        WEB_DIST: "tests/fixtures/web",
        LOG_LEVEL: "silent",
        AUTH_TRANSPORT: "bearer",
      }),
      { logger: false },
    );
    const login = async (account: string) => {
      const r = await app.inject({
        method: "POST",
        url: "/api/app/auth/login",
        payload: { account, password },
      });
      expect(r.statusCode).toBe(200);
      return r.json().token as string;
    };
    a = await login(`${prefix}_a`);
    b = await login(`${prefix}_b`);
    outside = await login(`${prefix}_outside`);
    for (const name of [prefix, `${prefix}_other`]) {
      const r = await app.inject({
        method: "POST",
        url: "/api/app/spaces",
        headers: headers(),
        payload: { name },
      });
      expect(r.statusCode).toBe(200);
      if (!spaceId) spaceId = r.json().id;
      else otherSpace = r.json().id;
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/app/spaces/${spaceId}/members`,
          headers: headers(),
          payload: { userId: bid },
        })
      ).statusCode,
    ).toBe(200);
  });
  afterAll(async () => {
    await app?.close();
    const owned = await db.db
      .select({ id: spaces.id })
      .from(spaces)
      .where(like(spaces.name, `${prefix}%`));
    if (owned.length) {
      const ids = owned.map((row) => row.id);
      await db.db
        .update(files)
        .set({ parentId: null })
        .where(inArray(files.spaceId, ids));
      await db.db.delete(files).where(inArray(files.spaceId, ids));
      await db.db.delete(spaces).where(inArray(spaces.id, ids));
    }
    await db.db.delete(appUsers).where(like(appUsers.account, `${prefix}%`));
    await db.close();
  });
  test("文件查询严格隔离空间和身份，名称变更采用独立修订", async () => {
    let doc = await create("doc", "文档");
    // 此用例验证成员编辑及修订冲突，显式授予编辑权限；默认只读由文件权限测试覆盖。
    await app.inject({
      method: "PUT",
      url: `/api/app/files/${doc.id}/member-permission`,
      headers: headers(a),
      payload: { permission: "edit" },
    });
    doc = (
      await app.inject({ url: `/api/app/files/${doc.id}`, headers: headers(a) })
    ).json();
    expect(
      (
        await app.inject({
          url: `/api/app/files/${doc.id}`,
          headers: headers(outside),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: `/api/app/spaces/${spaceId}/tree`,
          headers: headers(outside),
        })
      ).statusCode,
    ).toBe(403);
    const rename = await app.inject({
      method: "PATCH",
      url: `/api/app/files/${doc.id}`,
      headers: headers(b),
      payload: {
        name: "成员修改",
        expectedMetadataRevision: doc.metadataRevision,
      },
    });
    expect(rename.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/app/files/${doc.id}`,
          headers: headers(),
          payload: {
            name: "旧修订修改",
            expectedMetadataRevision: doc.metadataRevision,
          },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/app/files/${doc.id}`,
          headers: headers(),
          payload: {
            name: "越权公开",
            visibility: "public",
            expectedMetadataRevision: rename.json().metadataRevision,
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/app/spaces/${spaceId}`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(409);
  });
  test("父子类型、循环、跨空间和目录第一个位置校验", async () => {
    const folder = await create("folder", "文件夹");
    const nested = await create("folder", "子文件夹", folder.id);
    const doc = await create("doc", "父子文档", nested.id);
    const sheet = await create("sheet", "表格");
    const alien = await create("folder", "另一空间", null, otherSpace);
    expect((await move(folder.id, doc.id)).statusCode).toBe(409);
    expect((await move(doc.id, sheet.id)).statusCode).toBe(400);
    expect((await move(doc.id, alien.id)).statusCode).toBe(409);
    const first = await create("doc", "第一篇", folder.id);
    const second = await create("doc", "第二篇", folder.id);
    expect((await move(second.id, folder.id, first.id)).statusCode).toBe(200);
    const tree = await app.inject({
      url: `/api/app/spaces/${spaceId}/tree?parentId=${folder.id}`,
      headers: headers(),
    });
    const order = tree.json().items.map((row: { id: string }) => row.id);
    expect(order.indexOf(second.id)).toBeLessThan(order.indexOf(first.id));
    expect((await move(doc.id, folder.id, alien.id)).statusCode).toBe(409);
    // 同时反向移动，两事务使用相同空间锁，最终仍不可能成环。
    const x = await create("folder", "并发X"),
      y = await create("folder", "并发Y");
    const rx = await current(x.id),
      ry = await current(y.id);
    const outcomes = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/app/files/${x.id}/move`,
        headers: headers(),
        payload: {
          parentId: y.id,
          expectedMetadataRevision: rx.metadataRevision,
        },
      }),
      app.inject({
        method: "POST",
        url: `/api/app/files/${y.id}/move`,
        headers: headers(),
        payload: {
          parentId: x.id,
          expectedMetadataRevision: ry.metadataRevision,
        },
      }),
    ]);
    expect(outcomes.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });
  test("恢复仅同一删除批次，原父已删时必须选择新位置", async () => {
    const folder = await create("folder", "批次文件夹");
    const older = await create("doc", "先单独删除", folder.id);
    const active = await create("doc", "随目录删除", folder.id);
    expect((await remove(older.id)).statusCode).toBe(200);
    expect((await remove(folder.id)).statusCode).toBe(200);
    expect((await restore(older.id)).statusCode).toBe(409);
    expect((await restore(older.id, { parentId: null })).statusCode).toBe(200);
    expect((await restore(folder.id)).statusCode).toBe(200);
    expect((await current(active.id)).deletedAt).toBeNull();
    expect((await current(older.id)).parentId).toBeNull();
    const deletedOlder = await create("doc", "仍应保留在回收站", folder.id);
    await remove(deletedOlder.id);
    await remove(folder.id);
    await restore(folder.id);
    expect(
      (
        await app.inject({
          url: `/api/app/files/${deletedOlder.id}`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(409);
    const trash = await app.inject({
      url: `/api/app/spaces/${spaceId}/files?scope=trash`,
      headers: headers(),
    });
    expect(
      trash
        .json()
        .items.some((row: { id: string }) => row.id === deletedOlder.id),
    ).toBe(true);
  });
  test("收藏和最近访问按账号隔离，成员不能永久删除，移除成员即失效", async () => {
    const doc = await create("doc", "收藏");
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/app/files/${doc.id}/favorite`,
          headers: headers(),
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/app/files/${doc.id}/visit`,
          headers: headers(),
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    for (const scope of ["favorites", "recent"]) {
      const own = await app.inject({
        url: `/api/app/spaces/${spaceId}/files?scope=${scope}`,
        headers: headers(),
      });
      expect(
        own.json().items.some((row: { id: string }) => row.id === doc.id),
      ).toBe(true);
      const other = await app.inject({
        url: `/api/app/spaces/${spaceId}/files?scope=${scope}`,
        headers: headers(b),
      });
      expect(other.json().items).toHaveLength(0);
    }
    const details = await app.inject({
      url: `/api/app/files/${doc.id}`,
      headers: headers(),
    });
    expect(details.json().favorite).toBe(true);
    expect(details.json().accessedAt).toBeString();
    const sharing = await app.inject({
      method: "PUT",
      url: `/api/app/files/${doc.id}/share`,
      headers: headers(),
      payload: { visibility: "public", password: "cascade-pass" },
    });
    expect(sharing.statusCode).toBe(200);
    const grant = await app.inject({
      method: "POST",
      url: `/api/public/shares/${sharing.json().token}/unlock`,
      headers: {
        origin: loadMinmdConfig(
          loadConfig({ DATABASE_URL: url!, APP_ENV: "staging" }),
        ).allowedOrigins[0]!,
      },
      payload: { password: "cascade-pass" },
    });
    expect(grant.statusCode).toBe(200);
    const [share] = await db.db
      .select()
      .from(fileShares)
      .where(eq(fileShares.fileId, doc.id));
    expect(
      await db.db
        .select()
        .from(shareGuestSessions)
        .where(eq(shareGuestSessions.shareId, share!.id)),
    ).toHaveLength(1);
    expect(
      await db.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, doc.id)),
    ).toHaveLength(1);
    expect(
      await db.db
        .select()
        .from(fileVersions)
        .where(eq(fileVersions.fileId, doc.id)),
    ).toHaveLength(1);
    const [initialContent] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, doc.id));
    await db.db.insert(documentUpdates).values({
      fileId: doc.id,
      epoch: initialContent!.epoch,
      revision: initialContent!.revision,
      update: initialContent!.documentState!,
    });
    expect(
      await db.db
        .select()
        .from(documentUpdates)
        .where(eq(documentUpdates.fileId, doc.id)),
    ).toHaveLength(1);
    expect(
      await db.db
        .select()
        .from(fileFavorites)
        .where(eq(fileFavorites.fileId, doc.id)),
    ).toHaveLength(1);
    expect(
      await db.db
        .select()
        .from(fileVisits)
        .where(eq(fileVisits.fileId, doc.id)),
    ).toHaveLength(1);
    await remove(doc.id);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/app/files/${doc.id}/purge`,
          headers: headers(b),
          payload: { confirm: true },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/app/files/${doc.id}/purge`,
          headers: headers(),
          payload: { confirm: true },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: `/api/app/files/${doc.id}`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(404);
    for (const table of [fileContents, fileVersions, documentUpdates])
      expect(
        await db.db.select().from(table).where(eq(table.fileId, doc.id)),
      ).toHaveLength(0);
    for (const table of [fileFavorites, fileVisits])
      expect(
        await db.db.select().from(table).where(eq(table.fileId, doc.id)),
      ).toHaveLength(0);
    expect(
      await db.db
        .select()
        .from(fileShares)
        .where(eq(fileShares.fileId, doc.id)),
    ).toHaveLength(0);
    expect(
      await db.db
        .select()
        .from(shareGuestSessions)
        .where(eq(shareGuestSessions.shareId, share!.id)),
    ).toHaveLength(0);
    const remaining = await create("doc", "移除后禁用");
    await app.inject({
      method: "DELETE",
      url: `/api/app/spaces/${spaceId}/members/${bid}`,
      headers: headers(),
    });
    expect(
      (
        await app.inject({
          url: `/api/app/files/${remaining.id}`,
          headers: headers(b),
        })
      ).statusCode,
    ).toBe(403);
  });
});
