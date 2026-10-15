import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/app_server/src/app";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import { hashPassword } from "../../system/server/src/modules/auth/password";
import { appUsers } from "../../apps/app_server/src/database/schema/users";
import { spaces } from "../../apps/app_server/src/database/schema/spaces";
import { files } from "../../apps/app_server/src/database/schema/files";
import {
  assets,
  fileAssets,
  versionAssets,
} from "../../apps/app_server/src/database/schema/assets";
import {
  fileContents,
  fileVersions,
} from "../../apps/app_server/src/database/schema/contents";
const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw Error("媒体测试只允许独立_test库");
(url ? describe : describe.skip)(
  "独立媒体上传、预览、Range、下载与权限",
  () => {
    const db = createDatabase(url ?? "postgresql://localhost/unused_test");
    const prefix = `media_${randomUUID().replaceAll("-", "")}`,
      password = "Media-test-123!";
    let app: Awaited<ReturnType<typeof buildApp>>,
      directory: string,
      spaceId: string,
      token: string,
      otherToken: string;
    const userIds: string[] = [];
    const previousDirectory = process.env.ASSET_STORAGE_DIR;
    const headers = (credential = token) => ({
      authorization: `Bearer ${credential}`,
    });
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    );
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypisom00000000"),
    ]);
    const upload = (
      bytes: Buffer,
      name: string,
      mime: string,
      parent?: string,
      credential = token,
    ) => {
      const boundary = "media-upload-boundary";
      return app.inject({
        method: "POST",
        url: `/api/app/spaces/${spaceId}/media${parent ? `?parentId=${parent}` : ""}`,
        headers: {
          ...headers(credential),
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`,
          ),
          bytes,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      });
    };
    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), "minmd-media-"));
      const users = await db.db
        .insert(appUsers)
        .values(
          ["owner", "other"].map((suffix) => ({
            account: `${prefix}_${suffix}`,
            passwordHash: "pending",
          })),
        )
        .returning();
      userIds.push(...users.map((u) => u.id));
      await db.db
        .update(appUsers)
        .set({ passwordHash: await hashPassword(password) })
        .where(inArray(appUsers.id, userIds));
      process.env.ASSET_STORAGE_DIR = directory;
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
      for (const suffix of ["owner", "other"]) {
        const login = await app.inject({
          method: "POST",
          url: "/api/app/auth/login",
          payload: { account: `${prefix}_${suffix}`, password },
        });
        expect(login.statusCode).toBe(200);
        if (suffix === "owner") token = login.json().token;
        else otherToken = login.json().token;
      }
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
      if (previousDirectory === undefined) delete process.env.ASSET_STORAGE_DIR;
      else process.env.ASSET_STORAGE_DIR = previousDirectory;
      if (spaceId) {
        await db.db
          .update(files)
          .set({ parentId: null })
          .where(eq(files.spaceId, spaceId));
        await db.db.delete(files).where(eq(files.spaceId, spaceId));
        await db.db.delete(assets).where(eq(assets.spaceId, spaceId));
        await db.db.delete(spaces).where(eq(spaces.id, spaceId));
      }
      if (userIds.length)
        await db.db.delete(appUsers).where(inArray(appUsers.id, userIds));
      await db.close();
      if (directory) await rm(directory, { recursive: true, force: true });
    });
    test.each([
      ["sample.pdf", "application/pdf", pdf, "pdf"],
      ["sample.png", "image/png", png, "image"],
      ["sample.mp4", "video/mp4", mp4, "video"],
    ] as const)(
      "%s 原子创建并可预览和下载，当前与历史附件引用完整",
      async (name, mime, bytes, kind) => {
        const response = await upload(bytes, name, mime);
        expect(response.statusCode).toBe(200);
        const file = response.json();
        expect(file.kind).toBe(kind);
        const content = await app.inject({
          url: `/api/app/files/${file.id}/content`,
          headers: headers(),
        });
        expect(content.statusCode).toBe(200);
        const assetId = content.json().projection.assetId as string;
        expect(
          (
            await db.db
              .select()
              .from(fileAssets)
              .where(eq(fileAssets.fileId, file.id))
          )[0]?.assetId,
        ).toBe(assetId);
        const [version] = await db.db
          .select()
          .from(fileVersions)
          .where(eq(fileVersions.fileId, file.id));
        expect(
          (
            await db.db
              .select()
              .from(versionAssets)
              .where(eq(versionAssets.versionId, version!.id))
          )[0]?.assetId,
        ).toBe(assetId);
        const download = await app.inject({
          url: `/api/app/assets/${assetId}?download=true`,
          headers: headers(),
        });
        expect(download.statusCode).toBe(200);
        expect(download.headers["content-type"]).toContain(mime);
        expect(download.headers["content-disposition"]).toContain("attachment");
        expect(Array.from(download.rawPayload)).toEqual(Array.from(bytes));
        const range = await app.inject({
          url: `/api/app/assets/${assetId}`,
          headers: { ...headers(), range: "bytes=2-7" },
        });
        expect(range.statusCode).toBe(206);
        expect(range.headers["content-range"]).toBe(
          `bytes 2-7/${bytes.length}`,
        );
        expect(Array.from(range.rawPayload)).toEqual(
          Array.from(bytes.subarray(2, 8)),
        );
        const suffix = await app.inject({
          url: `/api/app/assets/${assetId}`,
          headers: { ...headers(), range: "bytes=-4" },
        });
        expect(suffix.statusCode).toBe(206);
        expect(Array.from(suffix.rawPayload)).toEqual(
          Array.from(bytes.subarray(-4)),
        );
        const invalid = await app.inject({
          url: `/api/app/assets/${assetId}`,
          headers: { ...headers(), range: `bytes=${bytes.length}-` },
        });
        expect(invalid.statusCode).toBe(416);
        expect(invalid.headers["content-range"]).toBe(
          `bytes */${bytes.length}`,
        );
        expect(
          (
            await app.inject({
              url: `/api/app/assets/${assetId}`,
              headers: { ...headers(otherToken), range: "bytes=0-1" },
            })
          ).statusCode,
        ).toBe(403);
        expect(
          (await app.inject({ url: `/api/app/assets/${assetId}` })).statusCode,
        ).toBe(401);
        // 分享保持现有文件权限，匿名只在显式公开后可访问。
        const shared = await app.inject({
          method: "PUT",
          url: `/api/app/files/${file.id}/share`,
          headers: headers(),
          payload: {
            visibility: "public",
            audience: "anyone",
            permission: "read",
          },
        });
        expect(shared.statusCode).toBe(200);
        const shareToken = shared.json().token as string;
        const publicContent = await app.inject({
          url: `/api/public/shares/${shareToken}/content`,
        });
        expect(publicContent.statusCode).toBe(200);
        expect(publicContent.json().file.kind).toBe(kind);
        const publicRange = await app.inject({
          url: `/api/public/shares/${shareToken}/assets/${assetId}`,
          headers: { range: "bytes=0-4" },
        });
        expect(publicRange.statusCode).toBe(206);
        expect(
          (
            await app.inject({
              method: "POST",
              url: `/api/app/files/${file.id}/content-import`,
              headers: headers(),
              payload: {
                expectedRevision: 1,
                expectedEpoch: 1,
                projection: {},
              },
            })
          ).statusCode,
        ).toBe(400);
        await app.inject({
          method: "DELETE",
          url: `/api/app/files/${file.id}/share`,
          headers: headers(),
        });
        expect(
          (
            await app.inject({
              url: `/api/public/shares/${shareToken}/assets/${assetId}`,
              headers: { range: "bytes=0-4" },
            })
          ).statusCode,
        ).not.toBe(206);
        expect(
          (
            await db.db
              .select()
              .from(fileContents)
              .where(eq(fileContents.fileId, file.id))
          )[0]?.projection.assetId,
        ).toBe(assetId);
      },
    );
    test("格式伪造、跨空间上传和父节点无效均不留下空文件或附件", async () => {
      const beforeFiles = (
        await db.db.select().from(files).where(eq(files.spaceId, spaceId))
      ).length;
      const beforeAssets = (
        await db.db.select().from(assets).where(eq(assets.spaceId, spaceId))
      ).length;
      const beforeDisk = (await readdir(directory)).sort();
      expect(
        (await upload(Buffer.from("<html>"), "fake.pdf", "application/pdf"))
          .statusCode,
      ).toBe(400);
      expect(
        (await upload(pdf, "a.pdf", "application/pdf", undefined, otherToken))
          .statusCode,
      ).toBe(403);
      expect(
        (await upload(pdf, "a.pdf", "application/pdf", randomUUID()))
          .statusCode,
      ).toBe(409);
      expect(
        (await db.db.select().from(files).where(eq(files.spaceId, spaceId)))
          .length,
      ).toBe(beforeFiles);
      expect(
        (await db.db.select().from(assets).where(eq(assets.spaceId, spaceId)))
          .length,
      ).toBe(beforeAssets);
      expect((await readdir(directory)).sort()).toEqual(beforeDisk);
    });
    test("可直接上传到文件夹，通用创建接口不能生成空媒体文件", async () => {
      const folder = await app.inject({
        method: "POST",
        url: `/api/app/spaces/${spaceId}/files`,
        headers: headers(),
        payload: { name: "媒体目录", kind: "folder" },
      });
      expect(folder.statusCode).toBe(200);
      const result = await upload(
        png,
        "folder.png",
        "image/png",
        folder.json().id,
      );
      expect(result.statusCode).toBe(200);
      expect(result.json().parentId).toBe(folder.json().id);
      const placeholder = await app.inject({
        method: "POST",
        url: `/api/app/spaces/${spaceId}/files`,
        headers: headers(),
        payload: { name: "empty.pdf", kind: "pdf" },
      });
      expect(placeholder.statusCode).toBe(400);
    });
  },
);
