import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import JSZip from "jszip";
import { pptxMime } from "../../apps/app_server/src/modules/assets/validate";
import { and, eq, inArray } from "drizzle-orm";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import { hashPassword } from "../../system/server/src/modules/auth/password";
import { buildApp } from "../../apps/app_server/src/app";
import { appUsers } from "../../apps/app_server/src/database/schema/users";
import {
  spaces,
  spaceMembers,
} from "../../apps/app_server/src/database/schema/spaces";
import { files } from "../../apps/app_server/src/database/schema/files";
import {
  fileContents,
  fileVersions,
} from "../../apps/app_server/src/database/schema/contents";
import {
  assets,
  fileAssets,
  versionAssets,
} from "../../apps/app_server/src/database/schema/assets";
import { initializeFileContent } from "../../apps/app_server/src/modules/collaboration/storage";
import {
  pruneExistingFileVersions,
  pruneFileVersions,
} from "../../apps/app_server/src/modules/versions/retention";
import { cleanUnboundAssets } from "../../apps/app_server/src/modules/assets/service";
const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw Error("版本测试只允许独立_test库");
(url ? describe : describe.skip)("每个文件100版本与图片引用边界", () => {
  const db = createDatabase(url ?? "postgresql://localhost/unused_test");
  let userId: string, spaceId: string, directory: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const account = `retention_${randomUUID().replaceAll("-", "")}`,
    password = "Retention-123!";
  let token: string;
  const auth = () => ({ authorization: `Bearer ${token}` });
  const create = async (kind: "doc" | "sheet" | "slide") =>
    db.db.transaction(async (tx) => {
      const [file] = await tx
        .insert(files)
        .values({ name: kind, kind, spaceId, createdBy: userId })
        .returning();
      await initializeFileContent(tx, file!);
      return file!.id;
    });
  const content = async (fileId: string) =>
    (
      await db.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId))
    )[0]!;
  const versions = async (fileId: string) =>
    db.db.select().from(fileVersions).where(eq(fileVersions.fileId, fileId));
  const seed = async (fileId: string, amount = 105) => {
    const current = await content(fileId);
    await db.db.delete(fileVersions).where(eq(fileVersions.fileId, fileId));
    return db.db
      .insert(fileVersions)
      .values(
        Array.from({ length: amount }, (_, index) => ({
          fileId,
          revision: current.revision,
          epoch: current.epoch,
          source: ["auto", "manual", "import", "restore", "initial"][
            index % 5
          ]!,
          note: `seed-${index}`,
          projection: current.projection,
          documentState: current.documentState,
          engineState: current.engineState,
          createdAt: new Date(Date.now() - (amount - index) * 1000),
        })),
      )
      .returning();
  };
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "minmd-retention-"));
    const [user] = await db.db
      .insert(appUsers)
      .values({ account, passwordHash: await hashPassword(password) })
      .returning();
    userId = user!.id;
    const [space] = await db.db
      .insert(spaces)
      .values({ name: account, ownerId: userId })
      .returning();
    spaceId = space!.id;
    await db.db.insert(spaceMembers).values({ spaceId, userId });
  });
  afterAll(async () => {
    await app?.close();
    if (spaceId) {
      await db.db.delete(files).where(eq(files.spaceId, spaceId));
      await db.db.delete(assets).where(eq(assets.spaceId, spaceId));
      await db.db.delete(spaces).where(eq(spaces.id, spaceId));
    }
    if (userId) await db.db.delete(appUsers).where(eq(appUsers.id, userId));
    await db.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  test("启动清理已有版本，保留最新100个，文档/表格/PPT当前内容和图片均不变", async () => {
    const ids = await Promise.all([
      create("doc"),
      create("sheet"),
      create("slide"),
    ]);
    const before = await Promise.all(ids.map(content));
    const seeded = await Promise.all(ids.map((id) => seed(id, 305)));
    const imageRows = await db.db
      .insert(assets)
      .values(
        ["current", "retained", "expired"].map((name) => ({
          spaceId,
          storageKey: randomUUID(),
          filename: name + ".png",
          mime: "image/png",
          size: 3,
          checksum: "a".repeat(64),
          uploadedBy: userId,
          createdAt: new Date(0),
        })),
      )
      .returning();
    for (const image of imageRows)
      await writeFile(
        join(directory, image.storageKey),
        Buffer.from([1, 2, 3]),
      );
    const [currentImage, retainedImage, expiredImage] = imageRows;
    await db.db
      .insert(fileAssets)
      .values({ fileId: ids[0]!, assetId: currentImage!.id });
    await db.db.insert(versionAssets).values([
      { versionId: seeded[0]![0]!.id, assetId: currentImage!.id },
      { versionId: seeded[0]![304]!.id, assetId: retainedImage!.id },
      { versionId: seeded[0]![1]!.id, assetId: expiredImage!.id },
    ]);
    app = await buildApp(
      loadConfig({
        DATABASE_URL: url!,
        APP_ENV: "staging",
        AUTH_TRANSPORT: "bearer",
        LOG_LEVEL: "silent",
        WEB_CMS_DIST: "tests/fixtures/web-cms",
      }),
      { logger: false },
    );
    await app.ready();
    for (let i = 0; i < ids.length; i++) {
      expect(await content(ids[i]!)).toEqual(before[i]!);
      expect((await versions(ids[i]!)).map((v) => v.id).sort()).toEqual(
        seeded[i]!.slice(-100)
          .map((v) => v.id)
          .sort(),
      );
    }
    expect(await pruneExistingFileVersions(db)).toEqual({
      files: 0,
      deleted: 0,
    });
    await cleanUnboundAssets(db, directory, 1);
    for (const image of [currentImage!, retainedImage!]) {
      expect(
        (await db.db.select().from(assets).where(eq(assets.id, image.id)))
          .length,
      ).toBe(1);
      expect(await readFile(join(directory, image.storageKey))).toEqual(
        Buffer.from([1, 2, 3]),
      );
    }
    expect(
      (await db.db.select().from(assets).where(eq(assets.id, expiredImage!.id)))
        .length,
    ).toBe(0);
    const login = await app.inject({
      method: "POST",
      url: "/api/app/auth/login",
      payload: { account, password },
    });
    expect(login.statusCode).toBe(200);
    token = login.json().token;
  });
  test.each(["doc", "sheet"] as const)(
    "%s 导入、恢复、重复保存和并发新增后仍最多100版本",
    async (kind) => {
      const id = await create(kind);
      const seeded = await seed(id);
      const before = await content(id);
      const imported = await app.inject({
        method: "POST",
        url: `/api/app/files/${id}/content-import`,
        headers: auth(),
        payload: {
          expectedRevision: before.revision,
          expectedEpoch: before.epoch,
          projection: before.projection,
        },
      });
      expect(imported.statusCode).toBe(200);
      expect((await versions(id)).length).toBe(100);
      const state = await content(id);
      const restored = await app.inject({
        method: "POST",
        url: `/api/app/files/${id}/versions/${seeded[80]!.id}/restore`,
        headers: auth(),
        payload: {
          expectedRevision: state.revision,
          expectedEpoch: state.epoch,
        },
      });
      expect(restored.statusCode).toBe(200);
      expect((await versions(id)).length).toBe(100);
      const restoredState = await content(id);
      const saved = await app.inject({
        method: "POST",
        url: `/api/app/files/${id}/checkpoint`,
        headers: auth(),
        payload: { manual: true },
      });
      expect(saved.statusCode).toBe(200);
      expect((await versions(id)).length).toBeLessThanOrEqual(100);
      await Promise.all(
        Array.from({ length: 6 }, () =>
          db.db.transaction(async (tx) => {
            await tx
              .select()
              .from(fileContents)
              .where(eq(fileContents.fileId, id))
              .for("update");
            await tx.insert(fileVersions).values({
              fileId: id,
              revision: restoredState.revision,
              epoch: restoredState.epoch,
              source: "manual",
              projection: restoredState.projection,
            });
            await pruneFileVersions(tx, id);
          }),
        ),
      );
      expect((await versions(id)).length).toBe(100);
      expect(await content(id)).toEqual(restoredState);
      const old = await app.inject({
        url: `/api/app/files/${id}/versions/${seeded[0]!.id}`,
        headers: auth(),
      });
      expect(old.statusCode).toBe(404);
    },
  );
  test("PPT替换后保留100版本，新原文件和当前引用完整", async () => {
    const id = await create("slide");
    await seed(id);
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    );
    zip.file("_rels/.rels", "<Relationships/>");
    zip.file("ppt/presentation.xml", '<p:presentation xmlns:p="test"/>');
    zip.file("ppt/slides/slide1.xml", "<p:sld/>");
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    const [asset] = await db.db
      .insert(assets)
      .values({
        spaceId,
        storageKey: randomUUID(),
        filename: "retention.pptx",
        mime: pptxMime,
        size: bytes.length,
        checksum: "b".repeat(64),
        uploadedBy: userId,
        uploadedForFileId: id,
      })
      .returning();
    await writeFile(join(directory, asset!.storageKey), bytes);
    // 绑定通过实际服务，附件目录仅在此调用期间覆盖。
    const { bindPresentation } =
      await import("../../apps/app_server/src/modules/assets/presentation");
    await db.db.transaction((tx) =>
      bindPresentation(tx, directory, userId, id, {
        assetId: asset!.id,
        expectedRevision: 1,
        expectedEpoch: 1,
      }),
    );
    expect((await versions(id)).length).toBe(100);
    expect((await content(id)).projection.assetId).toBe(asset!.id);
    expect(
      Array.from(await readFile(join(directory, asset!.storageKey))),
    ).toEqual(Array.from(bytes));
    expect(
      (
        await db.db.select().from(fileAssets).where(eq(fileAssets.fileId, id))
      )[0]?.assetId,
    ).toBe(asset!.id);
  });
  test("事务失败时版本删除和引用释放一起回滚，99/100边界不误删", async () => {
    const id = await create("doc");
    const seeded = await seed(id, 101);
    const [image] = await db.db
      .select()
      .from(assets)
      .where(eq(assets.spaceId, spaceId))
      .limit(1);
    await db.db
      .insert(versionAssets)
      .values({ versionId: seeded[0]!.id, assetId: image!.id });
    await expect(
      db.db.transaction(async (tx) => {
        await pruneFileVersions(tx, id);
        throw Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect((await versions(id)).length).toBe(101);
    expect(
      (
        await db.db
          .select()
          .from(versionAssets)
          .where(eq(versionAssets.versionId, seeded[0]!.id))
      ).length,
    ).toBe(1);
    expect(await db.db.transaction((tx) => pruneFileVersions(tx, id))).toBe(1);
    expect(await db.db.transaction((tx) => pruneFileVersions(tx, id))).toBe(0);
    await db.db
      .delete(fileVersions)
      .where(
        and(
          eq(fileVersions.fileId, id),
          inArray(fileVersions.id, [seeded[1]!.id]),
        ),
      );
    expect((await versions(id)).length).toBe(99);
    expect(await db.db.transaction((tx) => pruneFileVersions(tx, id))).toBe(0);
  });
});
