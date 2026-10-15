import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { and, eq, like } from "drizzle-orm";
import * as Y from "yjs";
import JSZip from "jszip";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../apps/app_server/src/app";
import { appUsers } from "../../apps/app_server/src/database/schema/users";
import { spaces } from "../../apps/app_server/src/database/schema/spaces";
import { files } from "../../apps/app_server/src/database/schema/files";
import { assets } from "../../apps/app_server/src/database/schema/assets";
import {
  fileContents,
  fileVersions,
} from "../../apps/app_server/src/database/schema/contents";
import { demoImports } from "../../apps/app_server/src/database/schema/demo-imports";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import { hashPassword } from "../../system/server/src/modules/auth/password";
import { storeAsset } from "../../apps/app_server/src/modules/assets/service";
import { pptxMime } from "../../apps/app_server/src/modules/assets/validate";
import { documentProjection } from "../../apps/app_server/src/modules/collaboration/document-schema";
const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw Error("迁移测试仅使用独立_test库");
(url ? describe : describe.skip)("主动演示迁移身份、父子映射与失败重试", () => {
  const db = createDatabase(url ?? "postgresql://localhost/unused_test");
  const prefix = `demoimport_${Date.now()}`,
    password = "Demo-import-test-123!";
  let app: Awaited<ReturnType<typeof buildApp>>,
    userId: string,
    outsiderId: string,
    token: string,
    outsider: string,
    spaceId: string,
    directory: string;
  const previousDirectory = process.env.ASSET_STORAGE_DIR;
  const key = `${prefix}_key`;
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "原文保留" },
          { type: "documentReference", attrs: { id: "child", name: "子文档" } },
          ...[
            "#/document/child",
            "#/document/%63hild?tab=body#section",
            "#/preview/ppt",
            "https://outside.example/#/document/child",
            "#/document/not-imported",
            "#/document/%invalid",
          ].map((href) => ({
            type: "text",
            text: href,
            marks: [{ type: "link", attrs: { href } }],
          })),
        ],
      },
    ],
  };
  const entries = [
    {
      oldId: "child",
      parentOldId: "doc",
      kind: "doc",
      name: "子文档",
      projection: { type: "doc", content: [{ type: "paragraph" }] },
    },
    { oldId: "folder", kind: "folder", name: "原目录" },
    {
      oldId: "doc",
      parentOldId: "folder",
      kind: "doc",
      name: "原文档",
      projection: doc,
    },
    { oldId: "ppt", kind: "slide", name: "缺失PPT", missingAssets: true },
  ];
  const headers = (credential = token) => ({
    authorization: `Bearer ${credential}`,
  });
  const post = (payload: Record<string, unknown>, credential = token) =>
    app.inject({
      method: "POST",
      url: `/api/app/spaces/${spaceId}/demo-imports`,
      headers: headers(credential),
      payload,
    });
  let initial: {
    jobId: string;
    mapping: Record<string, string>;
    items: { oldId: string; status: string; fileId: string }[];
    status: string;
  };
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "minmd-demo-import-test-"));
    process.env.ASSET_STORAGE_DIR = directory;
    const hash = await hashPassword(password);
    const users = await db.db
      .insert(appUsers)
      .values(
        ["a", "outside"].map((suffix) => ({
          account: `${prefix}_${suffix}`,
          passwordHash: hash,
        })),
      )
      .returning();
    userId = users[0]!.id;
    outsiderId = users[1]!.id;
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
    const login = async (suffix: string) =>
      (
        await app.inject({
          method: "POST",
          url: "/api/app/auth/login",
          payload: { account: `${prefix}_${suffix}`, password },
        })
      ).json().token as string;
    token = await login("a");
    outsider = await login("outside");
    const created = await app.inject({
      method: "POST",
      url: "/api/app/spaces",
      headers: headers(),
      payload: { name: prefix },
    });
    expect(created.statusCode).toBe(200);
    spaceId = created.json().id;
  });
  afterAll(async () => {
    await app?.close();
    if (spaceId) {
      await db.db
        .update(files)
        .set({ parentId: null })
        .where(eq(files.spaceId, spaceId));
      await db.db.delete(files).where(eq(files.spaceId, spaceId));
      await db.db.delete(assets).where(eq(assets.spaceId, spaceId));
      await db.db.delete(spaces).where(eq(spaces.id, spaceId));
    }
    await db.db.delete(appUsers).where(like(appUsers.account, `${prefix}%`));
    await db.close();
    if (previousDirectory === undefined) delete process.env.ASSET_STORAGE_DIR;
    else process.env.ASSET_STORAGE_DIR = previousDirectory;
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  test("仅空间成员主动提交，JSON拒绝演示凭证和循环目录", async () => {
    expect(
      (await post({ idempotencyKey: key, entries }, outsider)).statusCode,
    ).toBe(403);
    expect(
      (await post({ idempotencyKey: key, entries, password: "demo-password" }))
        .statusCode,
    ).toBe(400);
    const cyclic = [
      { oldId: "a", parentOldId: "b", kind: "folder", name: "a" },
      { oldId: "b", parentOldId: "a", kind: "folder", name: "b" },
    ];
    expect(
      (await post({ idempotencyKey: key, entries: cyclic })).statusCode,
    ).toBe(400);
    expect(
      (
        await db.db
          .select()
          .from(demoImports)
          .where(eq(demoImports.spaceId, spaceId))
      ).length,
    ).toBe(0);
  });
  test("父子重建、引用映射、协作状态初始化，缺失资源明确失败", async () => {
    const response = await post({ idempotencyKey: key, entries });
    expect(response.statusCode).toBe(200);
    initial = response.json();
    expect(initial.status).toBe("partial");
    expect(
      initial.items.filter((item) => item.status === "success").length,
    ).toBe(3);
    const rows = await db.db
      .select()
      .from(files)
      .where(eq(files.spaceId, spaceId));
    expect(rows.length).toBe(3);
    expect(rows.every((file) => file.visibility === "private")).toBe(true);
    expect(rows.find((file) => file.id === initial.mapping.doc)!.parentId).toBe(
      initial.mapping.folder,
    );
    expect(
      rows.find((file) => file.id === initial.mapping.child)!.parentId,
    ).toBe(initial.mapping.doc);
    const [content] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, initial.mapping.doc!));
    expect(JSON.stringify(content!.projection)).toContain(
      initial.mapping.child!,
    );
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, content!.documentState!);
    expect(ydoc.getMap("minmd").get("initialized")).toBe(true);
    const expectedLinks = [
      `#/document/${initial.mapping.child}`,
      `#/document/${initial.mapping.child}?tab=body#section`,
      `#/preview/${initial.mapping.ppt}`,
      "https://outside.example/#/document/child",
      "#/document/not-imported",
      "#/document/%invalid",
    ];
    for (const projection of [content!.projection, documentProjection(ydoc)]) {
      const paragraph = (projection as typeof doc).content[0]!;
      const links = paragraph.content.flatMap((node) =>
        "marks" in node ? node.marks.map((mark) => mark.attrs.href) : [],
      );
      expect(links).toEqual(expectedLinks);
    }
    expect(JSON.stringify(doc)).toContain(
      "#/document/%63hild?tab=body#section",
    );
    expect(JSON.stringify(doc)).not.toContain(initial.mapping.child!);
    ydoc.destroy();
    expect(
      (
        await db.db
          .select()
          .from(fileVersions)
          .where(eq(fileVersions.fileId, initial.mapping.doc!))
      ).length,
    ).toBe(1);
    expect(initial.items.find((item) => item.oldId === "ppt")!.status).toBe(
      "failed",
    );
    expect(
      (
        await db.db
          .select()
          .from(files)
          .where(eq(files.id, initial.mapping.ppt!))
      ).length,
    ).toBe(0);
  });
  test("同键成功项不覆盖，补附件只重试失败项；任务及幂等键隔离", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    );
    zip.file("_rels/.rels", "<Relationships/>");
    zip.file("ppt/presentation.xml", '<p:presentation xmlns:p="test"/>');
    zip.file("ppt/slides/slide1.xml", "<p:sld/>");
    const asset = await storeAsset(
      db,
      directory,
      userId,
      spaceId,
      "demo.pptx",
      pptxMime,
      await zip.generateAsync({ type: "nodebuffer" }),
    );
    const retry = structuredClone(entries).map((entry) =>
      entry.oldId === "ppt"
        ? {
            ...entry,
            missingAssets: false,
            projection: { assetId: asset.id, slides: 99 },
          }
        : entry.oldId === "doc"
          ? {
              ...entry,
              projection: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "不要覆盖已成功正文" }],
                  },
                ],
              },
            }
          : entry,
    );
    const response = await post({ idempotencyKey: key, entries: retry });
    expect(response.statusCode).toBe(200);
    expect(response.json().jobId).toBe(initial.jobId);
    expect(response.json().mapping).toEqual(initial.mapping);
    expect(response.json().status).toBe("completed");
    const [content] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, initial.mapping.doc!));
    expect(JSON.stringify(content!.projection)).toContain("原文保留");
    expect(JSON.stringify(content!.projection)).not.toContain("不要覆盖");
    expect(
      (await db.db.select().from(files).where(eq(files.spaceId, spaceId)))
        .length,
    ).toBe(4);
    expect(
      (
        await post({
          idempotencyKey: key,
          entries: retry.map((entry) => ({ ...entry, name: "不同清单" })),
        })
      ).statusCode,
    ).toBe(409);
    const get = `/api/app/spaces/${spaceId}/demo-imports/${initial.jobId}`;
    expect(
      (await app.inject({ url: get, headers: headers() })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: get, headers: headers(outsider) })).statusCode,
    ).toBe(403);
    const [job] = await db.db
      .select()
      .from(demoImports)
      .where(
        and(
          eq(demoImports.spaceId, spaceId),
          eq(demoImports.id, initial.jobId),
        ),
      );
    expect(JSON.stringify(job)).not.toContain("原文保留");
  });
  test("表格初始化正式引擎身份及首个历史版本", async () => {
    const response = await post({
      idempotencyKey: `${prefix}_sheet`,
      entries: [
        {
          oldId: "sheet",
          kind: "sheet",
          name: "旧表格",
          projection: {
            sheets: [
              {
                id: "local-sheet",
                name: "工作表1",
                order: 0,
                status: 1,
                row: 10,
                column: 5,
                celldata: [{ r: 0, c: 0, v: { v: "真实导入" } }],
              },
            ],
          },
        },
      ],
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("completed");
    const fileId = response.json().mapping.sheet as string;
    const [content] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    expect(content!.engine).toBe("fortune");
    expect(content!.engineState).not.toBeNull();
    expect(JSON.stringify(content!.projection)).toContain("真实导入");
    const [version] = await db.db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.fileId, fileId));
    expect(version!.engineState).toEqual(content!.engineState);
  });
  test("非法文档及缺失资产独立回滚，重复并发不创建重复文件", async () => {
    const payload = {
      idempotencyKey: `${prefix}_parallel`,
      entries: [
        { oldId: "ok", kind: "folder", name: "并发目录" },
        {
          oldId: "bad",
          kind: "doc",
          name: "错误文档",
          projection: { type: "doc", content: [{ type: "unsupported" }] },
        },
        {
          oldId: "image",
          kind: "doc",
          name: "非法图片",
          projection: {
            type: "doc",
            content: [
              { type: "image", attrs: { assetId: crypto.randomUUID() } },
            ],
          },
        },
      ],
    };
    const responses = await Promise.all([post(payload), post(payload)]);
    expect(responses.every((response) => response.statusCode === 200)).toBe(
      true,
    );
    expect(responses[0]!.json().mapping).toEqual(responses[1]!.json().mapping);
    expect(
      responses[0]!.json().items.map((item: { status: string }) => item.status),
    ).toEqual(["success", "failed", "failed"]);
    expect(
      (await db.db.select().from(files).where(eq(files.spaceId, spaceId)))
        .length,
    ).toBe(6);
  });
  test("同空间另一成员不能读取任务，相同幂等键属于各自账号", async () => {
    const added = await app.inject({
      method: "POST",
      url: `/api/app/spaces/${spaceId}/members`,
      headers: headers(),
      payload: { userId: outsiderId },
    });
    expect(added.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          url: `/api/app/spaces/${spaceId}/demo-imports/${initial.jobId}`,
          headers: headers(outsider),
        })
      ).statusCode,
    ).toBe(404);
    const response = await post({ idempotencyKey: key, entries }, outsider);
    expect(response.statusCode).toBe(200);
    expect(response.json().jobId).not.toBe(initial.jobId);
    expect(response.json().mapping).not.toEqual(initial.mapping);
  });
});
