import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import JSZip from "jszip";
import { eq, inArray } from "drizzle-orm";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../apps/app_server/src/app";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import { hashPassword } from "../../system/server/src/modules/auth/password";
import { appUsers } from "../../apps/app_server/src/database/schema/users";
import { spaces } from "../../apps/app_server/src/database/schema/spaces";
import { files } from "../../apps/app_server/src/database/schema/files";
import {
  fileAssets,
  versionAssets,
} from "../../apps/app_server/src/database/schema/assets";
import { fileVersions } from "../../apps/app_server/src/database/schema/contents";
import { pptxMime } from "../../apps/app_server/src/modules/assets/validate";
import { cleanUnboundAssets } from "../../apps/app_server/src/modules/assets/service";
import { assets } from "../../apps/app_server/src/database/schema/assets";

const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw Error("附件测试只允许独立_test数据库");
(url ? describe : describe.skip)("私有附件真实上传与读取边界", () => {
  const db = createDatabase(url ?? "postgresql://localhost/unused_test");
  const prefix = `assetcheck_${Date.now()}`;
  const userIds: string[] = [],
    spaceIds: string[] = [],
    assetIds: string[] = [],
    fileIds: string[] = [];
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  let app: Awaited<ReturnType<typeof buildApp>>, directory: string;
  let token: string, outsiderToken: string;
  const auth = () => ({ authorization: `Bearer ${token}` });
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "minmd-assets-test-"));
    const previous = process.env.ASSET_STORAGE_DIR;
    process.env.ASSET_STORAGE_DIR = directory;
    try {
      app = await buildApp(
        loadConfig({
          DATABASE_URL: url,
          APP_ENV: "staging",
          AUTH_TRANSPORT: "bearer",
          LOG_LEVEL: "silent",
          WEB_CMS_DIST: "tests/fixtures/web-cms",
        }),
        { logger: false },
      );
    } finally {
      if (previous === undefined) delete process.env.ASSET_STORAGE_DIR;
      else process.env.ASSET_STORAGE_DIR = previous;
    }
    for (const suffix of ["member", "outsider"]) {
      const [user] = await db.db
        .insert(appUsers)
        .values({
          account: `${prefix}_${suffix}`,
          passwordHash: await hashPassword("AssetTestPass-2026!"),
        })
        .returning();
      userIds.push(user!.id);
      const login = await app.inject({
        method: "POST",
        url: "/api/app/auth/login",
        payload: { account: user!.account, password: "AssetTestPass-2026!" },
      });
      expect(login.statusCode).toBe(200);
      if (suffix === "member") token = login.json().token;
      else outsiderToken = login.json().token;
    }
    const created = await app.inject({
      method: "POST",
      url: "/api/app/spaces",
      headers: auth(),
      payload: { name: "附件验收空间" },
    });
    expect(created.statusCode).toBe(200);
    spaceIds.push(created.json().id);
  });
  afterAll(async () => {
    await app?.close();
    if (fileIds.length)
      await db.db.delete(files).where(inArray(files.id, fileIds));
    if (assetIds.length)
      await db.db.delete(assets).where(inArray(assets.id, assetIds));
    if (spaceIds.length)
      await db.db.delete(spaces).where(inArray(spaces.id, spaceIds));
    if (userIds.length)
      await db.db.delete(appUsers).where(inArray(appUsers.id, userIds));
    await db.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  const upload = (
    bytes: Buffer,
    mime: string,
    spaceId = spaceIds[0]!,
    filename = "../../image.png",
  ) => {
    const boundary = "minmd-test-boundary";
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({
      method: "POST",
      url: `/api/app/spaces/${spaceId}/assets`,
      headers: {
        ...auth(),
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
  };
  test("上传后成员可读，匿名和其他账号不可读，原名不成为路径", async () => {
    const uploaded = await upload(png, "image/png");
    expect(uploaded.statusCode).toBe(200);
    const asset = uploaded.json();
    assetIds.push(asset.id);
    expect(asset.filename).toBe("image.png");
    expect(asset.storageKey).toBeUndefined();
    const read = await app.inject({ url: asset.url, headers: auth() });
    expect(read.statusCode).toBe(200);
    expect(read.rawPayload).toEqual(png);
    expect(read.headers["cache-control"]).toBe("no-store");
    expect((await app.inject(asset.url)).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: asset.url,
          headers: { authorization: `Bearer ${outsiderToken}` },
        })
      ).statusCode,
    ).toBe(403);
    const [stored] = await db.db
      .select()
      .from(assets)
      .where(eq(assets.id, asset.id));
    expect(stored!.storageKey).not.toContain("image");
    expect(stored!.checksum).toHaveLength(64);
  });
  test("伪造图片与超限被拒绝且不创建附件记录", async () => {
    expect((await upload(png, "image/jpeg")).statusCode).toBe(400);
    expect(
      (await upload(Buffer.alloc(1024 * 1024 + 1), "image/png")).statusCode,
    ).toBe(413);
    const rows = await db.db
      .select()
      .from(assets)
      .where(eq(assets.spaceId, spaceIds[0]!));
    expect(rows).toHaveLength(1);
  });
  test("PPTX绑定校验修订并保留历史引用，清理只删除过期无引用附件", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    );
    zip.file("_rels/.rels", "<Relationships/>");
    zip.file("ppt/presentation.xml", '<p:presentation xmlns:p="test"/>');
    zip.file("ppt/slides/slide1.xml", "<p:sld/>");
    const first = await upload(
      await zip.generateAsync({ type: "nodebuffer" }),
      pptxMime,
      spaceIds[0],
      "first.pptx",
    );
    expect(first.statusCode).toBe(200);
    const asset = first.json();
    assetIds.push(asset.id);
    const created = await app.inject({
      method: "POST",
      url: `/api/app/spaces/${spaceIds[0]}/files`,
      headers: auth(),
      payload: { name: "验收PPT", kind: "slide" },
    });
    expect(created.statusCode).toBe(200);
    const fileId = created.json().id;
    fileIds.push(fileId);
    const bind = (assetId: string, expectedRevision = 1, expectedEpoch = 1) =>
      app.inject({
        method: "PUT",
        url: `/api/app/files/${fileId}/presentation`,
        headers: auth(),
        payload: { assetId, expectedRevision, expectedEpoch },
      });
    const result = await bind(asset.id);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      revision: 2,
      epoch: 2,
      projection: { name: "first.pptx", slides: 1 },
    });
    expect((await bind(asset.id)).statusCode).toBe(409);
    const unauth = await app.inject({
      method: "PUT",
      url: `/api/app/files/${fileId}/presentation`,
      headers: { authorization: `Bearer ${outsiderToken}` },
      payload: { assetId: asset.id, expectedRevision: 2, expectedEpoch: 2 },
    });
    expect(unauth.statusCode).toBe(403);
    zip.file("ppt/slides/slide2.xml", "<p:sld/>");
    const second = await upload(
      await zip.generateAsync({ type: "nodebuffer" }),
      pptxMime,
      spaceIds[0],
      "second.pptx",
    );
    expect(second.statusCode).toBe(200);
    const next = second.json();
    assetIds.push(next.id);
    expect((await bind(next.id, 2, 2)).json()).toMatchObject({
      revision: 3,
      epoch: 3,
      projection: { slides: 2 },
    });
    expect(
      await db.db
        .select()
        .from(fileAssets)
        .where(eq(fileAssets.fileId, fileId)),
    ).toHaveLength(1);
    const history = await db.db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.fileId, fileId));
    expect(history).toHaveLength(3);
    expect(
      await db.db
        .select()
        .from(versionAssets)
        .where(eq(versionAssets.assetId, asset.id)),
    ).toHaveLength(1);
    await db.db
      .update(assets)
      .set({ createdAt: new Date(Date.now() - 48 * 3600000) })
      .where(inArray(assets.id, assetIds));
    await cleanUnboundAssets(db, directory, 24);
    expect(
      await db.db.select().from(assets).where(eq(assets.id, asset.id)),
    ).toHaveLength(1);
    expect(
      await db.db.select().from(assets).where(eq(assets.id, next.id)),
    ).toHaveLength(1);
    expect(
      await db.db.select().from(assets).where(eq(assets.id, assetIds[0]!)),
    ).toHaveLength(0);
  });
  test("未绑定附件在宽限期内保留，磁盘删除失败回滚后下轮可重试", async () => {
    const response = await upload(png, "image/png");
    expect(response.statusCode).toBe(200);
    const id = response.json().id as string;
    assetIds.push(id);
    await cleanUnboundAssets(db, directory, 24);
    let [row] = await db.db.select().from(assets).where(eq(assets.id, id));
    expect(row).toBeDefined();
    const path = join(directory, row!.storageKey);
    expect(await Bun.file(path).exists()).toBe(true);
    await db.db
      .update(assets)
      .set({ createdAt: new Date(Date.now() - 48 * 3600000) })
      .where(eq(assets.id, id));
    await rm(path);
    await mkdir(path);
    await cleanUnboundAssets(db, directory, 24);
    expect(
      await db.db.select().from(assets).where(eq(assets.id, id)),
    ).toHaveLength(1);
    await rm(path, { recursive: true });
    await Bun.write(path, png);
    await cleanUnboundAssets(db, directory, 24);
    expect(
      await db.db.select().from(assets).where(eq(assets.id, id)),
    ).toHaveLength(0);
    expect(await Bun.file(path).exists()).toBe(false);
  });
});
