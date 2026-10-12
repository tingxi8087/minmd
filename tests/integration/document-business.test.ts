import { afterAll, beforeAll, describe, test, expect } from "bun:test";
import { and, eq, inArray, like } from "drizzle-orm";
import * as Y from "yjs";
import { buildApp } from "../../apps/app_server/src/app";
import { appUsers } from "../../apps/app_server/src/database/schema/users";
import { files } from "../../apps/app_server/src/database/schema/files";
import { spaces } from "../../apps/app_server/src/database/schema/spaces";
import {
  documentUpdates,
  fileContents,
  fileVersions,
} from "../../apps/app_server/src/database/schema/contents";
import { documentProjection } from "../../apps/app_server/src/modules/collaboration/document-schema";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import { hashPassword } from "../../system/server/src/modules/auth/password";
import { DocumentRooms } from "../../apps/app_server/src/modules/collaboration/document-room";
const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw new Error("文档业务测试只能使用独立_test库");
(url ? describe : describe.skip)("正式文档正文与历史版本边界", () => {
  const db = createDatabase(url ?? "postgresql://localhost/unused_test");
  const prefix = `docbusiness_${Date.now()}`;
  const password = "Doc-business-test-123!";
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string,
    otherToken: string,
    spaceId: string,
    fileId: string,
    versionId: string;
  const headers = (credential = token) => ({
    authorization: `Bearer ${credential}`,
  });
  const doc = (text: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  const content = () =>
    app.inject({ url: `/api/app/files/${fileId}/content`, headers: headers() });
  const versions = () =>
    app.inject({
      url: `/api/app/files/${fileId}/versions`,
      headers: headers(),
    });
  beforeAll(async () => {
    const hash = await hashPassword(password);
    await db.db.insert(appUsers).values(
      ["a", "outside"].map((suffix) => ({
        account: `${prefix}_${suffix}`,
        passwordHash: hash,
      })),
    );
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
    const login = async (suffix: string) => {
      const r = await app.inject({
        method: "POST",
        url: "/api/app/auth/login",
        payload: { account: `${prefix}_${suffix}`, password },
      });
      expect(r.statusCode).toBe(200);
      return r.json().token as string;
    };
    token = await login("a");
    otherToken = await login("outside");
    const s = await app.inject({
      method: "POST",
      url: "/api/app/spaces",
      headers: headers(),
      payload: { name: prefix },
    });
    expect(s.statusCode).toBe(200);
    spaceId = s.json().id;
    const f = await app.inject({
      method: "POST",
      url: `/api/app/spaces/${spaceId}/files`,
      headers: headers(),
      payload: { kind: "doc", name: "历史文档" },
    });
    expect(f.statusCode).toBe(200);
    fileId = f.json().id;
  });
  afterAll(async () => {
    await app?.close();
    if (spaceId) {
      await db.db
        .update(files)
        .set({ parentId: null })
        .where(eq(files.spaceId, spaceId));
      await db.db.delete(files).where(eq(files.spaceId, spaceId));
      await db.db.delete(spaces).where(eq(spaces.id, spaceId));
    }
    await db.db.delete(appUsers).where(like(appUsers.account, `${prefix}%`));
    await db.close();
  });
  test("内容投影与初始版本一致，非成员与不兼容客户端不能访问", async () => {
    const c = await content();
    expect(c.statusCode).toBe(200);
    expect(c.json().revision).toBe(1);
    expect(c.json().epoch).toBe(1);
    expect(c.json().projection.content[0].attrs.blockId).toBeString();
    const v = await versions();
    expect(v.json().total).toBe(1);
    versionId = v.json().items[0].id;
    for (const path of [
      "content",
      "versions",
      `versions/${versionId}`,
      "collaboration-ticket",
    ]) {
      const r = await app.inject({
        method: path === "collaboration-ticket" ? "POST" : "GET",
        url: `/api/app/files/${fileId}/${path}`,
        headers: headers(otherToken),
        ...(path === "collaboration-ticket"
          ? { payload: { schemaVersion: 1 } }
          : {}),
      });
      expect(r.statusCode).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/app/files/${fileId}/collaboration-ticket`,
          headers: headers(),
          payload: { schemaVersion: 2 },
        })
      ).statusCode,
    ).toBe(409);
    const ticket = await app.inject({
      method: "POST",
      url: `/api/app/files/${fileId}/collaboration-ticket`,
      headers: headers(),
      payload: { schemaVersion: 1 },
    });
    expect(ticket.statusCode).toBe(200);
    expect(ticket.json().url.includes(ticket.json().ticket)).toBe(false);
    expect(ticket.json().maxSessions).toBe(10);
  });
  test("整体导入与恢复创建新世代，保留历史，旧修订命令被拒绝", async () => {
    const imported = await app.inject({
      method: "POST",
      url: `/api/app/files/${fileId}/content-import`,
      headers: headers(),
      payload: {
        expectedRevision: 1,
        expectedEpoch: 1,
        projection: doc("导入正文"),
      },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().epoch).toBe(2);
    expect(imported.json().revision).toBe(2);
    const c = await content();
    expect(JSON.stringify(c.json().projection)).toContain("导入正文");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/app/files/${fileId}/content-import`,
          headers: headers(),
          payload: {
            expectedRevision: 1,
            expectedEpoch: 1,
            projection: doc("旧客户端"),
          },
        })
      ).statusCode,
    ).toBe(409);
    const restore = await app.inject({
      method: "POST",
      url: `/api/app/files/${fileId}/versions/${versionId}/restore`,
      headers: headers(),
      payload: { expectedRevision: 2, expectedEpoch: 2 },
    });
    expect(restore.statusCode).toBe(200);
    expect(restore.json().epoch).toBe(3);
    const list = await versions();
    expect(list.json().total).toBe(3);
    expect(
      list.json().items.map((row: { source: string }) => row.source),
    ).toContain("restore");
    const preview = await app.inject({
      url: `/api/app/files/${fileId}/versions/${imported.json().versionId}`,
      headers: headers(),
    });
    expect(JSON.stringify(preview.json().projection)).toContain("导入正文");
    expect(JSON.stringify((await content()).json().projection)).not.toContain(
      "导入正文",
    );
  });
  test("无变化手动保存不新增版本，非法导入保持当前状态不变", async () => {
    const before = await versions();
    const c = await content();
    for (let i = 0; i < 2; i++)
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/app/files/${fileId}/checkpoint`,
            headers: headers(),
            payload: { manual: true, note: "重复保存" },
          })
        ).statusCode,
      ).toBe(200);
    expect((await versions()).json().total).toBe(before.json().total);
    const invalid = await app.inject({
      method: "POST",
      url: `/api/app/files/${fileId}/content-import`,
      headers: headers(),
      payload: {
        expectedRevision: c.json().revision,
        expectedEpoch: c.json().epoch,
        projection: { type: "doc", content: [{ type: "evilNode" }] },
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect((await content()).json().revision).toBe(c.json().revision);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/app/files/${fileId}/versions/${versionId}`,
          headers: headers(),
          payload: { note: "初始不能备注" },
        })
      ).statusCode,
    ).toBe(400);
  });
  test("AI稳定块局部事务保留格式，失败批次不部分写入", async () => {
    const before = (await content()).json();
    const seeded = await app.inject({
      method: "POST",
      url: `/api/app/files/${fileId}/content-import`,
      headers: headers(),
      payload: {
        expectedRevision: before.revision,
        expectedEpoch: before.epoch,
        projection: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "下周计划", marks: [{ type: "bold" }] },
              ],
            },
          ],
        },
      },
    });
    expect(seeded.statusCode).toBe(200);
    const current = (await content()).json();
    const blockId = current.projection.content[0].attrs.blockId as string;
    const owner = await db.db
      .select()
      .from(spaces)
      .where(eq(spaces.id, spaceId));
    const manager = new DocumentRooms(
      db,
      loadConfig({
        DATABASE_URL: url!,
        APP_ENV: "staging",
        WEB_CMS_DIST: "tests/fixtures/web-cms",
        LOG_LEVEL: "silent",
        AUTH_TRANSPORT: "bearer",
      }),
    );
    try {
      const changed = await manager.mutateDocumentAtomic(
        fileId,
        owner[0]!.ownerId,
        {
          expectedRevision: current.revision,
          expectedEpoch: current.epoch,
          operations: [
            {
              type: "replace_text",
              blockId,
              oldText: "下周",
              newText: "下周三",
            },
          ],
        },
      );
      expect(changed.epoch).toBe(current.epoch);
      expect(changed.touchedBlockIds).toContain(blockId);
      const modified = (await content()).json();
      expect(modified.projection.content[0].attrs.blockId).toBe(blockId);
      expect(modified.projection.content[0].content[0].marks).toEqual([
        { type: "bold" },
      ]);
      expect(JSON.stringify(modified.projection)).toContain("下周三计划");
      await expect(
        manager.mutateDocumentAtomic(fileId, owner[0]!.ownerId, {
          expectedRevision: modified.revision,
          expectedEpoch: modified.epoch,
          operations: [
            {
              type: "replace_text",
              blockId,
              oldText: "下周三",
              newText: "失败前半批",
            },
            { type: "delete_block", blockId: "不存在" },
          ],
        }),
      ).rejects.toThrow("目标块不存在");
      const unchanged = (await content()).json();
      expect(unchanged.revision).toBe(modified.revision);
      expect(unchanged.projection).toEqual(modified.projection);
      const typed = await manager.mutateDocumentAtomic(
        fileId,
        owner[0]!.ownerId,
        {
          expectedRevision: unchanged.revision,
          expectedEpoch: unchanged.epoch,
          operations: [
            {
              type: "set_block_type",
              blockId,
              nodeType: "heading",
              attrs: { level: 2 },
            },
            {
              type: "insert_blocks",
              blocks: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "新增稳定块" }],
                },
              ],
            },
          ],
        },
      );
      expect(typed.epoch).toBe(current.epoch);
      const projection = (await content()).json().projection;
      expect(projection.content[0].type).toBe("heading");
      expect(projection.content[0].attrs.level).toBe(2);
      expect(projection.content[0].attrs.blockId).toBe(blockId);
      expect(projection.content[1].attrs.blockId).toBeString();
      expect((await versions()).json().items[0].source).toBe("ai");
    } finally {
      await manager.close();
    }
  });
  test("检查点事务压缩覆盖日志，提交失败保留日志，历史和重启恢复不受影响", async () => {
    const config = loadConfig({
      DATABASE_URL: url!,
      APP_ENV: "staging",
      WEB_CMS_DIST: "tests/fixtures/web-cms",
      LOG_LEVEL: "silent",
      AUTH_TRANSPORT: "bearer",
    });
    const manager = new DocumentRooms(db, config);
    const [before] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    const [space] = await db.db
      .select()
      .from(spaces)
      .where(eq(spaces.id, spaceId));
    const history = await db.db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.fileId, fileId));
    const oldRevision = before!.revision - 1;
    const futureRevision = before!.revision + 100;
    // 已覆盖和尚未覆盖的日志使用真实持久化 Yjs 状态；高修订仅用于验证清理边界。
    await db.db
      .insert(documentUpdates)
      .values([
        {
          fileId,
          epoch: before!.epoch,
          revision: oldRevision,
          update: before!.documentState!,
        },
        {
          fileId,
          epoch: before!.epoch,
          revision: futureRevision,
          update: before!.documentState!,
        },
      ])
      .onConflictDoNothing();
    const logs = () =>
      db.db
        .select()
        .from(documentUpdates)
        .where(eq(documentUpdates.fileId, fileId));
    const original = await logs();
    const input = {
      expectedRevision: before!.revision,
      expectedEpoch: before!.epoch,
      operations: [
        {
          type: "insert_blocks" as const,
          blocks: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "压缩后可恢复" }],
            },
          ],
        },
      ],
    };
    try {
      await expect(
        manager.mutateDocumentAtomic(fileId, space!.ownerId, {
          ...input,
          onCommitted: async (tx) => {
            const pending = await tx
              .select()
              .from(documentUpdates)
              .where(eq(documentUpdates.fileId, fileId));
            expect(pending.some((row) => row.revision === oldRevision)).toBe(
              false,
            );
            expect(pending.some((row) => row.revision === futureRevision)).toBe(
              true,
            );
            throw Error("fixture commit rollback after compaction");
          },
        }),
      ).rejects.toThrow("fixture commit rollback after compaction");
      expect((await logs()).map((row) => row.id).sort()).toEqual(
        original.map((row) => row.id).sort(),
      );
      expect((await content()).json().revision).toBe(before!.revision);
      expect(
        (
          await db.db
            .select()
            .from(fileVersions)
            .where(eq(fileVersions.fileId, fileId))
        )
          .map((row) => row.id)
          .sort(),
      ).toEqual(history.map((row) => row.id).sort());
      const saved = await manager.mutateDocumentAtomic(
        fileId,
        space!.ownerId,
        input,
      );
      const remaining = await logs();
      expect(
        remaining.map((row) => row.revision).sort((a, b) => a - b),
      ).toEqual([saved.revision, futureRevision]);
      const preserved = await db.db
        .select()
        .from(fileVersions)
        .where(eq(fileVersions.fileId, fileId));
      for (const version of history)
        expect(preserved.find((row) => row.id === version.id)).toEqual(version);
      await manager.close();
      const restarted = new DocumentRooms(db, config);
      try {
        expect((await restarted.persistBarrier(fileId)).revision).toBe(
          saved.revision,
        );
        const [checkpoint] = await db.db
          .select()
          .from(fileContents)
          .where(eq(fileContents.fileId, fileId));
        const doc = new Y.Doc();
        try {
          Y.applyUpdate(doc, checkpoint!.documentState!);
          expect(documentProjection(doc)).toEqual(checkpoint!.projection);
          expect(JSON.stringify(documentProjection(doc))).toContain(
            "压缩后可恢复",
          );
        } finally {
          doc.destroy();
        }
      } finally {
        await restarted.close();
      }
    } finally {
      await manager.close();
      await db.db
        .delete(documentUpdates)
        .where(
          and(
            eq(documentUpdates.fileId, fileId),
            eq(documentUpdates.revision, futureRevision),
          ),
        );
    }
  });
});
