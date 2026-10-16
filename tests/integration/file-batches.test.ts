import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray, sql } from "drizzle-orm";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v5 as uuid } from "uuid";
import JSZip from "jszip";
import { pptxMime } from "../../apps/app_server/src/modules/assets/validate";
import { buildApp } from "../../apps/app_server/src/app";
import { appUsers } from "../../apps/app_server/src/database/schema/users";
import {
  spaces,
  spaceMembers,
} from "../../apps/app_server/src/database/schema/spaces";
import {
  files,
  fileFavorites,
} from "../../apps/app_server/src/database/schema/files";
import {
  fileContents,
  fileVersions,
} from "../../apps/app_server/src/database/schema/contents";
import { assets } from "../../apps/app_server/src/database/schema/assets";
import { fileTransferImports } from "../../apps/app_server/src/database/schema/file-transfers";
import { fileShares } from "../../apps/app_server/src/database/schema/shares";
import { fileAccessGrants } from "../../apps/app_server/src/database/schema/file-access";
import { storeAsset } from "../../apps/app_server/src/modules/assets/service";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import { hashPassword } from "../../system/server/src/modules/auth/password";

const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw Error("批量文件测试只允许独立 _test 库");
(url ? describe : describe.skip)("批量文件移动与副本", () => {
  const database = createDatabase(url ?? "postgresql://localhost/unused_test");
  const prefix = `batches_${Date.now()}`,
    password = "batch-test-123";
  const oldDirectory = process.env.ASSET_STORAGE_DIR;
  let app: Awaited<ReturnType<typeof buildApp>>, directory: string;
  let owner: string, member: string, ownerToken: string, memberToken: string;
  let spaceId: string,
    otherSpace: string,
    folder: string,
    doc: string,
    sheet: string,
    destination: string,
    imageId: string;
  const request = (
    method: "POST" | "GET" | "DELETE",
    path: string,
    payload?: object,
    token = ownerToken,
  ) =>
    app.inject({
      method,
      url: `/api/app/${path}`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
  const create = async (
    name: string,
    kind: string,
    parentId: string | null = null,
    space = spaceId,
  ) => {
    const response = await request("POST", `spaces/${space}/files`, {
      name,
      kind,
      parentId,
    });
    expect(response.statusCode).toBe(200);
    return response.json().id as string;
  };
  const batch = (
    operation: "move" | "copy",
    ids: string[],
    parentId: string | null,
    token = ownerToken,
    requestId = crypto.randomUUID(),
  ) =>
    request(
      "POST",
      `spaces/${spaceId}/files/batch-${operation}`,
      {
        fileIds: ids,
        parentId,
        ...(operation === "copy" ? { requestId } : {}),
      },
      token,
    );
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "minmd-batches-test-"));
    process.env.ASSET_STORAGE_DIR = directory;
    const passwordHash = await hashPassword(password);
    const users = await database.db
      .insert(appUsers)
      .values(
        ["owner", "member"].map((name) => ({
          account: `${prefix}_${name}`,
          passwordHash,
        })),
      )
      .returning();
    owner = users[0]!.id;
    member = users[1]!.id;
    app = await buildApp(
      loadConfig({
        DATABASE_URL: url!,
        APP_ENV: "staging",
        AUTH_TRANSPORT: "bearer",
        WEB_DIST: "tests/fixtures/web",
        WEB_CMS_DIST: "tests/fixtures/web-cms",
        LOG_LEVEL: "silent",
      }),
      { logger: false },
    );
    await app.ready();
    const login = async (name: string) =>
      (
        await request(
          "POST",
          "auth/login",
          { account: `${prefix}_${name}`, password },
          "",
        )
      ).json().token as string;
    ownerToken = await login("owner");
    memberToken = await login("member");
    spaceId = (await request("POST", "spaces", { name: prefix })).json().id;
    otherSpace = (
      await request("POST", "spaces", { name: `${prefix}_other` })
    ).json().id;
    await database.db.insert(spaceMembers).values({ spaceId, userId: member });
    folder = await create("资料", "folder");
    doc = await create("文档", "doc", folder);
    sheet = await create("预算", "sheet", folder);
    destination = await create("目标", "folder");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    );
    const image = await storeAsset(
      database,
      directory,
      owner,
      spaceId,
      "图片.png",
      "image/png",
      png,
    );
    imageId = image.id;
    const imported = await request("POST", `files/${doc}/content-import`, {
      expectedRevision: 1,
      expectedEpoch: 1,
      projection: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "彩色",
                marks: [{ type: "textStyle", attrs: { color: "#ff0000" } }],
              },
              { type: "documentReference", attrs: { id: sheet, name: "预算" } },
            ],
          },
          {
            type: "image",
            attrs: {
              assetId: image.id,
              src: image.url,
              align: "right",
              width: 200,
            },
          },
        ],
      },
    });
    expect(imported.statusCode).toBe(200);
    expect(
      (
        await request("POST", `files/${sheet}/content-import`, {
          expectedRevision: 1,
          expectedEpoch: 1,
          projection: {
            sheets: [
              {
                id: "sheet1",
                name: "预算",
                order: 0,
                status: 1,
                row: 100,
                column: 26,
                celldata: [
                  { r: 0, c: 0, v: { v: 12 } },
                  { r: 0, c: 1, v: { f: "=A1*2", v: 24 } },
                ],
              },
            ],
          },
        })
      ).statusCode,
    ).toBe(200);
    await database.db
      .insert(fileFavorites)
      .values({ userId: owner, fileId: doc });
  });
  afterAll(async () => {
    await app?.close();
    const ids = [spaceId, otherSpace].filter(Boolean);
    if (ids.length) {
      await database.db
        .update(files)
        .set({ parentId: null })
        .where(inArray(files.spaceId, ids));
      await database.db
        .delete(fileTransferImports)
        .where(inArray(fileTransferImports.spaceId, ids));
      await database.db.delete(files).where(inArray(files.spaceId, ids));
      await database.db.delete(assets).where(inArray(assets.spaceId, ids));
      await database.db.delete(spaces).where(inArray(spaces.id, ids));
    }
    if (owner || member)
      await database.db
        .delete(appUsers)
        .where(inArray(appUsers.id, [owner, member].filter(Boolean)));
    await database.close();
    if (directory) await rm(directory, { recursive: true, force: true });
    if (oldDirectory === undefined) delete process.env.ASSET_STORAGE_DIR;
    else process.env.ASSET_STORAGE_DIR = oldDirectory;
  });
  test("父子去重移动保留ID、内容、历史与收藏，重复提交安全", async () => {
    const before = await database.db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.fileId, doc));
    const moved = await batch("move", [folder, doc], destination);
    expect(moved.statusCode).toBe(200);
    expect(moved.json().total).toBe(1);
    expect(moved.json().items[0].id).toBe(folder);
    expect(
      (await database.db.select().from(files).where(eq(files.id, doc)))[0]!
        .parentId,
    ).toBe(folder);
    expect(
      await database.db
        .select()
        .from(fileVersions)
        .where(eq(fileVersions.fileId, doc)),
    ).toEqual(before);
    expect(
      (
        await database.db
          .select()
          .from(fileFavorites)
          .where(eq(fileFavorites.fileId, doc))
      ).length,
    ).toBe(1);
    expect((await batch("move", [folder, doc], destination)).statusCode).toBe(
      200,
    );
  });
  test("自身/后代、跨空间、无效或不可写目标整批拒绝", async () => {
    expect((await batch("move", [folder], doc)).statusCode).toBe(409);
    expect((await batch("copy", [folder], doc)).statusCode).toBe(409);
    expect((await batch("move", [sheet], doc)).statusCode).toBe(409);
    expect((await batch("copy", [sheet], doc)).statusCode).toBe(409);
    const foreign = await create("外部", "folder", null, otherSpace);
    expect((await batch("move", [doc], foreign)).statusCode).toBe(409);
    expect((await batch("copy", [foreign], null)).statusCode).toBe(409);
    const blocked = await create("只读目标", "doc");
    expect((await batch("copy", [doc], blocked, memberToken)).statusCode).toBe(
      403,
    );
    expect(
      (await batch("move", [doc], destination, memberToken)).statusCode,
    ).toBe(403);
    expect(
      (await batch("copy", [doc, crypto.randomUUID()], null)).statusCode,
    ).toBe(409);
  });
  test("只读源可复制；副本为当前账号私有、独立引擎与附件，引用重建且幂等绑定参数", async () => {
    const requestId = crypto.randomUUID();
    const before = Date.now();
    const copied = await batch(
      "copy",
      [folder, doc],
      null,
      memberToken,
      requestId,
    );
    expect(copied.statusCode).toBe(200);
    expect(copied.json().total).toBe(1);
    const copyRoot = copied.json().items[0].id as string;
    expect(copied.json().items[0].name).toBe("资料 副本");
    const descendants = await database.db
      .select()
      .from(files)
      .where(eq(files.parentId, copyRoot));
    expect(descendants.length).toBe(2);
    const copiedDoc = descendants.find((row) => row.kind === "doc")!,
      copiedSheet = descendants.find((row) => row.kind === "sheet")!;
    for (const file of [copiedDoc, copiedSheet]) {
      expect(file.createdBy).toBe(member);
      expect(file.visibility).toBe("private");
      expect(file.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    }
    const contents = await database.db
      .select()
      .from(fileContents)
      .where(inArray(fileContents.fileId, [copiedDoc.id, copiedSheet.id]));
    const docContent = contents.find((row) => row.fileId === copiedDoc.id)!;
    expect(docContent.revision).toBe(1);
    expect(docContent.epoch).toBe(1);
    expect(docContent.documentState!.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(docContent.projection);
    expect(serialized).toContain("#ff0000");
    expect(serialized).toContain(copiedSheet.id);
    expect(serialized).not.toContain(imageId);
    const newImage = (
      docContent.projection.content as {
        type: string;
        attrs?: { assetId: string };
      }[]
    ).find((node) => node.type === "image")!.attrs!.assetId;
    const [originalAsset, copiedAsset] = await Promise.all([
      database.db.select().from(assets).where(eq(assets.id, imageId)),
      database.db.select().from(assets).where(eq(assets.id, newImage)),
    ]);
    expect(copiedAsset[0]!.uploadedBy).toBe(member);
    expect(copiedAsset[0]!.storageKey).not.toBe(originalAsset[0]!.storageKey);
    expect(
      await Bun.file(join(directory, copiedAsset[0]!.storageKey)).bytes(),
    ).toEqual(
      await Bun.file(join(directory, originalAsset[0]!.storageKey)).bytes(),
    );
    const sheetContent = contents.find((row) => row.fileId === copiedSheet.id)!;
    expect(sheetContent.revision).toBe(1);
    expect(sheetContent.epoch).toBe(1);
    expect(sheetContent.engineState).toBeTruthy();
    expect(JSON.stringify(sheetContent.projection)).toContain("=A1*2");
    const copiedVersions = await database.db
      .select()
      .from(fileVersions)
      .where(inArray(fileVersions.fileId, [copiedDoc.id, copiedSheet.id]));
    expect(copiedVersions.length).toBe(2);
    expect(
      copiedVersions.every(
        (row) => row.source === "initial" && row.actorId === member,
      ),
    ).toBe(true);
    expect(
      await database.db
        .select()
        .from(fileShares)
        .where(
          inArray(fileShares.fileId, [copyRoot, copiedDoc.id, copiedSheet.id]),
        ),
    ).toEqual([]);
    expect(
      await database.db
        .select()
        .from(fileFavorites)
        .where(
          inArray(fileFavorites.fileId, [
            copyRoot,
            copiedDoc.id,
            copiedSheet.id,
          ]),
        ),
    ).toEqual([]);
    const replay = await batch(
      "copy",
      [doc, folder],
      null,
      memberToken,
      requestId,
    );
    expect(replay.statusCode).toBe(200);
    expect(replay.json().items[0].id).toBe(copyRoot);
    expect(
      (await batch("copy", [folder, doc], destination, memberToken, requestId))
        .statusCode,
    ).toBe(409);
    const second = await batch("copy", [folder], null, memberToken);
    expect(second.statusCode).toBe(200);
    expect(second.json().items[0].name).toBe("资料 副本 (1)");
    expect(
      (
        await request(
          "GET",
          `files/${copiedDoc.id}/content`,
          undefined,
          memberToken,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request(
          "GET",
          `files/${copiedSheet.id}/content`,
          undefined,
          memberToken,
        )
      ).statusCode,
    ).toBe(200);
  });
  test("同批源缺少管理权限不移动其他项", async () => {
    const own = await create("成员拥有", "doc");
    await database.db
      .update(files)
      .set({ createdBy: member })
      .where(eq(files.id, own));
    const before = (
      await database.db.select().from(files).where(eq(files.id, own))
    )[0]!;
    const denied = await batch("move", [own, doc], destination, memberToken);
    expect(denied.statusCode).toBe(403);
    expect(
      (await database.db.select().from(files).where(eq(files.id, own)))[0]!
        .parentId,
    ).toBe(before.parentId);
    await database.db.insert(fileAccessGrants).values({
      fileId: doc,
      userId: member,
      permission: "read",
      grantedBy: owner,
    });
  });
  test("批量移动与单文件变更共用锁顺序，不发生死锁", async () => {
    const item = await create("并发操作", "doc");
    const lock = await database.pool.connect();
    await lock.query("BEGIN");
    await lock.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,91731))",
      [spaceId],
    );
    const moving = Promise.resolve(batch("move", [item], destination));
    await Bun.sleep(50);
    const renaming = Promise.resolve(
      app.inject({
        method: "PATCH",
        url: `/api/app/files/${item}`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { name: "新名称", expectedMetadataRevision: 1 },
      }),
    );
    await Bun.sleep(50);
    await lock.query("COMMIT");
    lock.release();
    const results = await Promise.all([moving, renaming]);
    expect(results[0]!.statusCode).toBe(200);
    expect([200, 409]).toContain(results[1]!.statusCode);
  });
  test("表格内容写入与批量移动并发不会死锁或丢失公式", async () => {
    const item = await create("并发表格", "sheet");
    const lock = await database.pool.connect();
    await lock.query("BEGIN");
    await lock.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,91731))",
      [spaceId],
    );
    const moving = Promise.resolve(batch("move", [item], destination));
    await Bun.sleep(50);
    const writing = Promise.resolve(
      request("POST", `files/${item}/content-import`, {
        expectedRevision: 1,
        expectedEpoch: 1,
        projection: {
          sheets: [
            {
              id: "sheet1",
              name: "并发",
              order: 0,
              status: 1,
              row: 100,
              column: 26,
              celldata: [
                { r: 0, c: 0, v: { v: 17 } },
                { r: 0, c: 1, v: { f: "=A1*2", v: 34 } },
              ],
            },
          ],
        },
      }),
    );
    await Bun.sleep(50);
    await lock.query("COMMIT");
    lock.release();
    const results = await Promise.all([moving, writing]);
    expect(results.map((value) => value.statusCode)).toEqual([200, 200]);
    const [content] = await database.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, item));
    expect(JSON.stringify(content!.projection)).toContain("=A1*2");
    expect(
      (await database.db.select().from(files).where(eq(files.id, item)))[0]!
        .parentId,
    ).toBe(destination);
  });
  test("文档替换、分享写入和PPT绑定与批量移动并发保持一致", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    );
    zip.file("_rels/.rels", "<Relationships/>");
    zip.file("ppt/presentation.xml", '<p:presentation xmlns:p="test"/>');
    zip.file("ppt/slides/slide1.xml", "<p:sld/>");
    const asset = await storeAsset(
      database,
      directory,
      owner,
      spaceId,
      "并发.pptx",
      pptxMime,
      await zip.generateAsync({ type: "nodebuffer" }),
    );
    for (const operation of ["document", "share", "presentation"] as const) {
      const item = await create(
        `并发-${operation}`,
        operation === "presentation" ? "slide" : "doc",
      );
      const lock = await database.pool.connect();
      await lock.query("BEGIN");
      await lock.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,91731))",
        [spaceId],
      );
      const moving = Promise.resolve(batch("move", [item], destination));
      await Bun.sleep(50);
      const mutation = Promise.resolve(
        operation === "document"
          ? request("POST", `files/${item}/content-import`, {
              expectedRevision: 1,
              expectedEpoch: 1,
              projection: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "并发内容保留" }],
                  },
                ],
              },
            })
          : app.inject({
              method: "PUT",
              url: `/api/app/files/${item}/${operation === "share" ? "share" : "presentation"}`,
              headers: { authorization: `Bearer ${ownerToken}` },
              payload:
                operation === "share"
                  ? { visibility: "public" }
                  : {
                      assetId: asset.id,
                      expectedRevision: 1,
                      expectedEpoch: 1,
                    },
            }),
      );
      await Bun.sleep(50);
      await lock.query("COMMIT");
      lock.release();
      const results = await Promise.all([moving, mutation]);
      expect(results.map((value) => value.statusCode)).toEqual([200, 200]);
      const [metadata] = await database.db
        .select()
        .from(files)
        .where(eq(files.id, item));
      expect(metadata!.parentId).toBe(destination);
      if (operation === "share") expect(metadata!.visibility).toBe("public");
      else {
        const [content] = await database.db
          .select()
          .from(fileContents)
          .where(eq(fileContents.fileId, item));
        expect(JSON.stringify(content!.projection)).toContain(
          operation === "document" ? "并发内容保留" : asset.id,
        );
      }
    }
  });
  test("超限子树在授权循环及写入前拒绝", async () => {
    const root = await create("超限目录", "folder");
    await database.db
      .insert(files)
      .values(
        Array.from({ length: 1000 }, (_, index) => ({
          spaceId,
          createdBy: owner,
          parentId: root,
          kind: "doc",
          name: `条目${index}`,
          position: index,
        })),
      );
    expect((await batch("copy", [root], null)).statusCode).toBe(413);
    expect((await batch("move", [root], destination)).statusCode).toBe(413);
    expect(
      (await database.db.select().from(files).where(eq(files.id, root)))[0]!
        .parentId,
    ).toBe(null);
  });
  test("捕获后源内容变化整批冲突，清理已暂存附件，原请求可重新捕获重试", async () => {
    const requestId = crypto.randomUUID();
    const batchId = uuid(
      `${owner}:${requestId}`,
      "8c57382c-0678-4cb3-bf5e-c04ef7174962",
    );
    const lock = await database.pool.connect();
    await lock.query("BEGIN");
    await lock.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,91734))",
      [batchId],
    );
    const pending = Promise.resolve(
      batch("copy", [folder], null, ownerToken, requestId),
    );
    let staged = false;
    try {
      for (let attempt = 0; attempt < 200; attempt++) {
        const dirs = await readdir(join(directory, ".file-transfers")).catch(
          () => [],
        );
        for (const sub of dirs)
          if (
            await Bun.file(
              join(directory, ".file-transfers", sub, "pending-assets.json"),
            ).exists()
          )
            staged = true;
        if (staged) break;
        await Bun.sleep(10);
      }
      expect(staged).toBe(true);
      await database.db
        .update(fileContents)
        .set({
          revision: sql`${fileContents.revision}+1`,
          projectionRevision: sql`${fileContents.projectionRevision}+1`,
        })
        .where(eq(fileContents.fileId, doc));
    } finally {
      await lock.query("COMMIT");
      lock.release();
    }
    const response = await pending;
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("BATCH_CONFLICT");
    expect(
      (await batch("copy", [folder], null, ownerToken, requestId)).statusCode,
    ).toBe(200);
  });
  test("事务故障后无半成品或孤立附件，重试仍可成功", async () => {
    const beforeFiles = await database.db
      .select({ id: files.id })
      .from(files)
      .where(eq(files.spaceId, spaceId));
    const beforeAssets = (await readdir(directory)).filter(
      (name) => !name.startsWith("."),
    );
    await database.db.execute(
      sql`CREATE OR REPLACE FUNCTION batch_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM files WHERE id=NEW.file_id AND name='文档') THEN RAISE EXCEPTION 'injected copy failure'; END IF; RETURN NEW; END $$`,
    );
    await database.db.execute(
      sql`CREATE TRIGGER batch_test_reject BEFORE INSERT ON file_contents FOR EACH ROW EXECUTE FUNCTION batch_test_reject()`,
    );
    try {
      expect((await batch("copy", [folder], null)).statusCode).toBe(500);
    } finally {
      await database.db.execute(
        sql`DROP TRIGGER batch_test_reject ON file_contents`,
      );
      await database.db.execute(sql`DROP FUNCTION batch_test_reject()`);
    }
    expect(
      await database.db
        .select({ id: files.id })
        .from(files)
        .where(eq(files.spaceId, spaceId)),
    ).toEqual(beforeFiles);
    expect(
      (await readdir(directory)).filter((name) => !name.startsWith(".")),
    ).toEqual(beforeAssets);
    expect((await batch("copy", [folder], null)).statusCode).toBe(200);
  });
});
