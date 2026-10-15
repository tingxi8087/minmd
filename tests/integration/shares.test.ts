import { afterAll, beforeAll, describe, test, expect } from "bun:test";
import { eq, like } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildApp } from "../../apps/app_server/src/app";
import { appUsers } from "../../apps/app_server/src/database/schema/users";
import { spaces } from "../../apps/app_server/src/database/schema/spaces";
import { files } from "../../apps/app_server/src/database/schema/files";
import {
  assets,
  fileAssets,
  versionAssets,
} from "../../apps/app_server/src/database/schema/assets";
import {
  fileShares,
  shareGuestSessions,
} from "../../apps/app_server/src/database/schema/shares";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import {
  hashPassword,
  hashToken,
} from "../../system/server/src/modules/auth/password";
const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw new Error("分享测试只能使用独立_test库");
(url ? describe : describe.skip)("公开分享与密码访客授权边界", () => {
  const db = createDatabase(url ?? "postgresql://localhost/unused_test");
  const prefix = `sharecheck_${Date.now()}`;
  const password = "Share-user-test-123!";
  const origin = "http://127.0.0.1:5173";
  let app: Awaited<ReturnType<typeof buildApp>>,
    a: string,
    outside: string,
    aid: string,
    spaceId: string,
    fileId: string,
    folderId: string,
    token: string,
    cookie: string,
    newCookie: string,
    assetId: string,
    unboundId: string,
    directory: string;
  const previousDirectory = process.env.ASSET_STORAGE_DIR;
  const previousPublic = process.env.APP_PUBLIC_ORIGIN;
  const headers = (credential = a) => ({
    authorization: `Bearer ${credential}`,
  });
  const save = (values: Record<string, unknown>) =>
    app.inject({
      method: "PUT",
      url: `/api/app/files/${fileId}/share`,
      headers: headers(),
      payload: values,
    });
  const read = (value = token, visitor?: string) =>
    app.inject({
      url: `/api/public/shares/${value}/content`,
      headers: visitor ? { cookie: visitor } : {},
    });
  const unlock = (value = token, secret = "guest-pass") =>
    app.inject({
      method: "POST",
      url: `/api/public/shares/${value}/unlock`,
      headers: { origin },
      payload: { password: secret },
    });
  const cookieOf = (response: {
    headers: Record<string, string | number | string[] | undefined>;
  }) => {
    const value = response.headers["set-cookie"];
    return String(Array.isArray(value) ? value[0] : value).split(";")[0]!;
  };
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "minmd-shares-test-"));
    process.env.ASSET_STORAGE_DIR = directory;
    process.env.APP_PUBLIC_ORIGIN = origin;
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
    aid = users[0]!.id;
    app = await buildApp(
      loadConfig({
        DATABASE_URL: url!,
        APP_ENV: "staging",
        WEB_CMS_DIST: "tests/fixtures/web-cms",
        WEB_DIST: "tests/fixtures/web",
        LOG_LEVEL: "silent",
        AUTH_TRANSPORT: "bearer",
        PUBLIC_ORIGIN: origin,
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
    a = await login("a");
    outside = await login("outside");
    const space = await app.inject({
      method: "POST",
      url: "/api/app/spaces",
      headers: headers(),
      payload: { name: prefix },
    });
    expect(space.statusCode).toBe(200);
    spaceId = space.json().id;
    for (const kind of ["doc", "folder"]) {
      const file = await app.inject({
        method: "POST",
        url: `/api/app/spaces/${spaceId}/files`,
        headers: headers(),
        payload: { kind, name: "分享测试" },
      });
      expect(file.statusCode).toBe(200);
      if (kind === "doc") fileId = file.json().id;
      else folderId = file.json().id;
    }
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
    if (previousPublic === undefined) delete process.env.APP_PUBLIC_ORIGIN;
    else process.env.APP_PUBLIC_ORIGIN = previousPublic;
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  test("私有与空间隔离，公开Token只保存哈希且只返回一次", async () => {
    const initial = await app.inject({
      url: `/api/app/files/${fileId}/share`,
      headers: headers(),
    });
    expect(initial.json().visibility).toBe("private");
    expect(initial.json().enabled).toBe(false);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/app/files/${folderId}/share`,
          headers: headers(),
          payload: { visibility: "public" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/app/files/${fileId}/share`,
          headers: headers(outside),
          payload: { visibility: "public" },
        })
      ).statusCode,
    ).toBe(403);
    const publicShare = await save({ visibility: "public" });
    expect(publicShare.statusCode).toBe(200);
    token = publicShare.json().token;
    expect(token).toBeString();
    const [state] = await db.db
      .select()
      .from(fileShares)
      .where(eq(fileShares.fileId, fileId));
    expect(state!.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(state)).not.toContain(token);
    const config = await app.inject({
      url: `/api/app/files/${fileId}/share`,
      headers: headers(),
    });
    expect(config.json().token).toBeUndefined();
    expect(config.json().passwordHash).toBeUndefined();
    const guest = await read();
    expect(guest.statusCode).toBe(200);
    expect(guest.headers["cache-control"]).toBe("no-store");
    expect(guest.json().file.id).toBe(fileId);
    expect(guest.json().content.revision).toBe(1);
    expect(
      (await app.inject({ url: `/api/app/files/${fileId}/versions` }))
        .statusCode,
    ).toBe(401);
    expect((await save({ visibility: "public" })).json().token).toBeUndefined();
  });
  test("密码使用HttpOnly短期授权，改密码使原授权立即失效", async () => {
    expect(
      (
        await save({
          visibility: "public",
          password: "guest-pass",
          expiresAt: new Date(Date.now() + 30 * 60000).toISOString(),
        })
      ).statusCode,
    ).toBe(200);
    const metadata = await app.inject({ url: `/api/public/shares/${token}` });
    expect(metadata.statusCode).toBe(200);
    expect(metadata.json().requiresPassword).toBe(true);
    expect(metadata.json().file).toBeUndefined();
    expect(metadata.json().content).toBeUndefined();
    expect((await read()).json().code).toBe("SHARE_PASSWORD_REQUIRED");
    expect((await unlock(token, "wrong-pass")).statusCode).toBe(403);
    const granted = await unlock();
    expect(granted.statusCode).toBe(200);
    cookie = cookieOf(granted);
    expect(String(granted.headers["set-cookie"])).toMatch(/HttpOnly/i);
    expect(String(granted.headers["set-cookie"])).toMatch(/SameSite=Strict/i);
    expect((await read(token, cookie)).statusCode).toBe(200);
    const [state] = await db.db
      .select()
      .from(fileShares)
      .where(eq(fileShares.fileId, fileId));
    expect(await Bun.password.verify("guest-pass", state!.passwordHash!)).toBe(
      true,
    );
    const [savedGuest] = await db.db
      .select()
      .from(shareGuestSessions)
      .where(eq(shareGuestSessions.shareId, state!.id));
    expect(savedGuest!.expiresAt.getTime()).toBeLessThanOrEqual(
      state!.expiresAt!.getTime(),
    );
    expect(savedGuest!.tokenHash).not.toBe(cookie.split("=")[1]);
    expect(
      (await save({ visibility: "public", password: "new-guest-pass" }))
        .statusCode,
    ).toBe(200);
    expect((await read(token, cookie)).statusCode).toBe(403);
    const renewed = await unlock(token, "new-guest-pass");
    expect(renewed.statusCode).toBe(200);
    newCookie = cookieOf(renewed);
    expect((await read(token, newCookie)).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/app/files/${fileId}/collaboration-ticket`,
          headers: { cookie: newCookie, origin },
          payload: { schemaVersion: 1 },
        })
      ).statusCode,
    ).toBe(401);
    const child = await app.inject({
      method: "POST",
      url: `/api/app/spaces/${spaceId}/files`,
      headers: headers(),
      payload: { kind: "doc", name: "不继承分享的子文档", parentId: fileId },
    });
    expect(child.statusCode).toBe(200);
    const childShare = await app.inject({
      url: `/api/app/files/${child.json().id}/share`,
      headers: headers(),
    });
    expect(childShare.json().visibility).toBe("private");
    expect(childShare.json().enabled).toBe(false);
    expect(
      (
        await app.inject({
          url: `/api/app/files/${child.json().id}/content`,
          headers: { cookie: newCookie },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: `/api/public/shares/${token}/content?fileId=${child.json().id}`,
          headers: { cookie: newCookie },
        })
      ).json().file.id,
    ).toBe(fileId);
  });
  test("访客仅能读取当前引用附件，历史引用和未绑定附件不开放", async () => {
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZL1sAAAAASUVORK5CYII=",
      "base64",
    );
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const storageKey = crypto.randomUUID();
      await Bun.write(join(directory, storageKey), bytes);
      const [row] = await db.db
        .insert(assets)
        .values({
          spaceId,
          storageKey,
          filename: `fixture${i}.png`,
          mime: "image/png",
          size: bytes.length,
          checksum: createHash("sha256").update(bytes).digest("hex"),
          uploadedBy: aid,
        })
        .returning();
      ids.push(row!.id);
    }
    assetId = ids[0]!;
    unboundId = ids[1]!;
    let c = await app.inject({
      url: `/api/app/files/${fileId}/content`,
      headers: headers(),
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/app/files/${fileId}/content-import`,
          headers: headers(),
          payload: {
            expectedRevision: c.json().revision,
            expectedEpoch: c.json().epoch,
            projection: {
              type: "doc",
              content: [
                {
                  type: "image",
                  attrs: { src: `/api/app/assets/${assetId}`, assetId },
                },
                { type: "paragraph" },
              ],
            },
          },
        })
      ).statusCode,
    ).toBe(200);
    const image = await app.inject({
      url: `/api/public/shares/${token}/assets/${assetId}`,
      headers: { cookie: newCookie },
    });
    expect(image.statusCode).toBe(200);
    expect(image.rawPayload).toEqual(bytes);
    expect(image.headers["cache-control"]).toBe("no-store");
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/app/files/${fileId}`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(200);
    expect((await read(token, newCookie)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          url: `/api/public/shares/${token}/assets/${assetId}`,
          headers: { cookie: newCookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/app/files/${fileId}/restore`,
          headers: headers(),
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: `/api/public/shares/${token}/assets/${assetId}`,
          headers: { cookie: newCookie },
        })
      ).statusCode,
    ).toBe(200);

    expect(
      (
        await app.inject({
          url: `/api/public/shares/${token}/assets/${unboundId}`,
          headers: { cookie: newCookie },
        })
      ).statusCode,
    ).toBe(403);
    c = await app.inject({
      url: `/api/app/files/${fileId}/content`,
      headers: headers(),
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/app/files/${fileId}/content-import`,
          headers: headers(),
          payload: {
            expectedRevision: c.json().revision,
            expectedEpoch: c.json().epoch,
            projection: { type: "doc", content: [{ type: "paragraph" }] },
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await db.db
          .select()
          .from(versionAssets)
          .where(eq(versionAssets.assetId, assetId))
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await app.inject({
          url: `/api/public/shares/${token}/assets/${assetId}`,
          headers: { cookie: newCookie },
        })
      ).statusCode,
    ).toBe(403);
  });
  test("换链接、过期、回收站和撤销均立即撤销正文与附件访问", async () => {
    const rotated = await save({
      visibility: "public",
      rotate: true,
      password: null,
    });
    expect(rotated.statusCode).toBe(200);
    const old = token;
    token = rotated.json().token;
    expect(token).not.toBe(old);
    expect((await read(old, newCookie)).statusCode).toBe(404);
    expect((await read()).statusCode).toBe(200);
    await db.db
      .update(fileShares)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(fileShares.fileId, fileId));
    expect((await read()).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          url: `/api/public/shares/${token}/assets/${assetId}`,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await save({ visibility: "public", expiresAt: null })).statusCode,
    ).toBe(200);
    expect((await read()).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/app/files/${fileId}`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(200);
    expect((await read()).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/app/files/${fileId}/restore`,
          headers: headers(),
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/app/files/${fileId}/share`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(200);
    expect((await read()).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          url: `/api/app/files/${fileId}/share`,
          headers: headers(),
        })
      ).json().visibility,
    ).toBe("private");
  });
});
