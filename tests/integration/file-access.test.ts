import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assets } from "../../apps/app_server/src/database/schema/assets";
import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../../apps/app_server/src/app";
import { loadConfig } from "../../system/server/src/config/env";
import { loadMinmdConfig } from "../../config/minmd";
import { createDatabase } from "../../system/server/src/database/client";
import { hashPassword } from "../../system/server/src/modules/auth/password";
import { appUsers } from "../../apps/app_server/src/database/schema/users";
import { spaces } from "../../apps/app_server/src/database/schema/spaces";
import { files } from "../../apps/app_server/src/database/schema/files";
const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw new Error("文件权限测试只允许独立 _test 库");
(url ? describe : describe.skip)("文件级授权、申请和登录公开范围", () => {
  const db = createDatabase(url ?? "postgresql://localhost/unused_test");
  const prefix = `access_${Date.now()}`;
  const users: { id: string; token: string }[] = [];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let spaceId: string,
    fileId: string,
    shareToken: string,
    port: number,
    directory: string;
  const previousDirectory = process.env.ASSET_STORAGE_DIR;
  const wait = async (ready: () => boolean) => {
    const deadline = Date.now() + 4000;
    while (!ready()) {
      if (Date.now() > deadline) throw Error("协作状态等待超时");
      await Bun.sleep(10);
    }
  };
  const headers = (i = 0) => ({
    authorization: `Bearer ${users[i]!.token}`,
    origin: "http://127.0.0.1:9811",
  });
  const call = (
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    index = 0,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/api/app${path}`,
      headers: headers(index),
      ...(payload ? { payload } : {}),
    });
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "minmd-access-assets-"));
    process.env.ASSET_STORAGE_DIR = directory;
    const config = loadConfig({
      DATABASE_URL: url!,
      APP_ENV: "staging",
      WEB_CMS_DIST: "tests/fixtures/web-cms",
      WEB_DIST: "tests/fixtures/web",
      PUBLIC_ORIGIN: "http://127.0.0.1:9811",
      AUTH_TRANSPORT: "bearer",
      LOG_LEVEL: "silent",
    });
    app = await buildApp(
      config,
      { logger: false },
      loadMinmdConfig(config, {}),
    );
    const hash = await hashPassword("File-access-test-123!");
    for (const suffix of ["owner", "member", "outside", "requester"]) {
      const [user] = await db.db
        .insert(appUsers)
        .values({
          account: `${prefix}_${suffix}`,
          nickname: suffix,
          passwordHash: hash,
        })
        .returning();
      const login = await app.inject({
        method: "POST",
        url: "/api/app/auth/login",
        payload: { account: user!.account, password: "File-access-test-123!" },
      });
      users.push({ id: user!.id, token: login.json().token });
    }
    const space = await call("POST", "/spaces", 0, { name: prefix });
    spaceId = space.json().id;
    expect(
      (
        await call("POST", `/spaces/${spaceId}/members`, 0, {
          userId: users[1]!.id,
        })
      ).statusCode,
    ).toBe(200);
    const file = await call("POST", `/spaces/${spaceId}/files`, 0, {
      kind: "doc",
      name: "授权验收",
    });
    expect(file.statusCode).toBe(200);
    expect(file.json().visibility).toBe("private");
    expect(file.json().memberPermission).toBe("read");
    fileId = file.json().id;
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw Error("监听失败");
    port = address.port;
  });
  afterAll(async () => {
    if (app) await app.close();
    if (spaceId) {
      await db.db.delete(files).where(eq(files.spaceId, spaceId));
      await db.db.delete(assets).where(eq(assets.spaceId, spaceId));
      await db.db.delete(spaces).where(eq(spaces.id, spaceId));
    }
    if (users.length)
      await db.db.delete(appUsers).where(
        inArray(
          appUsers.id,
          users.map((user) => user.id),
        ),
      );
    await db.close();
    if (previousDirectory === undefined) delete process.env.ASSET_STORAGE_DIR;
    else process.env.ASSET_STORAGE_DIR = previousDirectory;
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  test("空间成员默认只读，空间外用户不能读取正文或目录", async () => {
    expect((await call("GET", `/files/${fileId}/content`, 1)).statusCode).toBe(
      200,
    );
    expect(
      (
        await call("POST", `/files/${fileId}/collaboration-ticket`, 1, {
          schemaVersion: 1,
        })
      ).statusCode,
    ).toBe(403);
    expect((await call("GET", `/files/${fileId}/content`, 2)).statusCode).toBe(
      403,
    );
    expect((await call("GET", `/spaces/${spaceId}/tree`, 2)).statusCode).toBe(
      403,
    );
    expect(
      (await call("PUT", `/files/${fileId}/share`, 1, { visibility: "public" }))
        .statusCode,
    ).toBe(403);
  });
  test("指定外部用户可编辑单个文件，但不能管理分享或查看空间", async () => {
    expect(
      (
        await call("PUT", `/files/${fileId}/access-grants`, 0, {
          userId: users[2]!.id,
          permission: "edit",
        })
      ).statusCode,
    ).toBe(200);
    expect((await call("GET", `/files/${fileId}/content`, 2)).statusCode).toBe(
      200,
    );
    expect(
      (
        await call("POST", `/files/${fileId}/collaboration-ticket`, 2, {
          schemaVersion: 1,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call("PUT", `/files/${fileId}/share`, 2, { visibility: "public" }))
        .statusCode,
    ).toBe(403);
    expect((await call("GET", `/spaces/${spaceId}/tree`, 2)).statusCode).toBe(
      403,
    );
    expect((await call("GET", "/shared-with-me", 2)).json().items[0].id).toBe(
      fileId,
    );
    expect(
      (await call("DELETE", `/files/${fileId}/access-grants/${users[2]!.id}`))
        .statusCode,
    ).toBe(200);
    expect((await call("GET", `/files/${fileId}/content`, 2)).statusCode).toBe(
      403,
    );
  });
  test("成员显式只读覆盖默认编辑；非管理者不能授权", async () => {
    expect(
      (
        await call("PUT", `/files/${fileId}/member-permission`, 0, {
          permission: "edit",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call("POST", `/files/${fileId}/collaboration-ticket`, 1, {
          schemaVersion: 1,
        })
      ).statusCode,
    ).toBe(200);
    await call("PUT", `/files/${fileId}/access-grants`, 0, {
      userId: users[1]!.id,
      permission: "read",
    });
    expect(
      (
        await call("POST", `/files/${fileId}/collaboration-ticket`, 1, {
          schemaVersion: 1,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call("PUT", `/files/${fileId}/access-grants`, 1, {
          userId: users[2]!.id,
          permission: "edit",
        })
      ).statusCode,
    ).toBe(403);
  });
  test("申请去重、审批可降低到只读、再次申请编辑、通知隔离", async () => {
    for (let i = 0; i < 2; i++)
      expect(
        (
          await call("POST", `/files/${fileId}/access-requests`, 3, {
            permission: "edit",
            reason: "参与整理",
          })
        ).statusCode,
      ).toBe(200);
    const settings = await call("GET", `/files/${fileId}/access-settings`);
    expect(settings.json().requests.length).toBe(1);
    const requestId = settings.json().requests[0].id;
    expect(
      (
        await call(
          "POST",
          `/files/${fileId}/access-requests/${requestId}/decision`,
          1,
          { decision: "approve" },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(
          "POST",
          `/files/${fileId}/access-requests/${requestId}/decision`,
          0,
          { decision: "approve", permission: "read" },
        )
      ).statusCode,
    ).toBe(200);
    expect((await call("GET", `/files/${fileId}/content`, 3)).statusCode).toBe(
      200,
    );
    expect(
      (
        await call("POST", `/files/${fileId}/collaboration-ticket`, 3, {
          schemaVersion: 1,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call("POST", `/files/${fileId}/access-requests`, 3, {
          permission: "edit",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call("DELETE", `/files/${fileId}/access-request`, 3)).statusCode,
    ).toBe(200);
    expect(
      (await call("GET", `/files/${fileId}/access`, 3)).json().request.status,
    ).toBe("cancelled");
    const notifications = await call(
      "GET",
      "/notifications?page=1&pageSize=10",
      3,
    );
    expect(
      notifications
        .json()
        .items.some((item: { message: string }) =>
          item.message.includes("只读"),
        ),
    ).toBe(true);
    expect(
      (await call("GET", "/notifications?page=1&pageSize=10", 2))
        .json()
        .items.every(
          (item: { message: string }) => !item.message.includes("申请已批准"),
        ),
    ).toBe(true);
  });
  test("登录公开仅允许前台用户读取，所有人公开访客只读", async () => {
    let response = await call("PUT", `/files/${fileId}/share`, 0, {
      visibility: "public",
      audience: "authenticated",
      permission: "edit",
    });
    expect(response.statusCode).toBe(200);
    shareToken = response.json().token;
    expect(
      (await app.inject(`/api/public/shares/${shareToken}/content`)).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: `/api/public/shares/${shareToken}/content`,
          headers: headers(2),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call("POST", `/shares/${shareToken}/accept`, 2, {})).json()
        .permission,
    ).toBe("edit");
    expect(
      (
        await call("POST", `/files/${fileId}/collaboration-ticket`, 2, {
          schemaVersion: 1,
        })
      ).statusCode,
    ).toBe(200);
    response = await call("PUT", `/files/${fileId}/share`, 0, {
      visibility: "public",
      audience: "anyone",
      permission: "read",
    });
    expect(response.statusCode).toBe(200);
    expect(
      (await app.inject(`/api/public/shares/${shareToken}/content`)).statusCode,
    ).toBe(200);
    expect(
      (
        await call("POST", `/files/${fileId}/collaboration-ticket`, 2, {
          schemaVersion: 1,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/app/files/${fileId}/collaboration-ticket`,
          payload: { schemaVersion: 1 },
        })
      ).statusCode,
    ).toBe(401);
    expect((await call("DELETE", `/files/${fileId}/share`)).statusCode).toBe(
      200,
    );
    expect(
      (await app.inject(`/api/public/shares/${shareToken}/content`)).statusCode,
    ).toBe(404);
    expect((await call("GET", `/files/${fileId}/content`, 2)).statusCode).toBe(
      403,
    );
  });
  test("文档降为只读立即断开外部编辑会话，负责人保持在线", async () => {
    await call("PUT", `/files/${fileId}/access-grants`, 0, {
      userId: users[2]!.id,
      permission: "edit",
    });
    const clients: {
      provider: HocuspocusProvider;
      ws: HocuspocusProviderWebsocket;
      doc: Y.Doc;
      ready: boolean;
      closed: number;
    }[] = [];
    try {
      for (const index of [0, 2]) {
        const ticket = await call(
          "POST",
          `/files/${fileId}/collaboration-ticket`,
          index,
          { schemaVersion: 1 },
        );
        expect(ticket.statusCode).toBe(200);
        const ws = new HocuspocusProviderWebsocket({
          url: `ws://127.0.0.1:${port}/api/app/collaboration/documents/${fileId}`,
          WebSocketPolyfill: WebSocket,
          autoConnect: false,
        });
        const doc = new Y.Doc();
        const state = { ready: false, closed: 0 };
        const provider = new HocuspocusProvider({
          name: fileId,
          document: doc,
          websocketProvider: ws,
          token: ticket.json().ticket,
          onSynced: ({ state: synced }) => {
            if (synced) {
              state.ready = true;
              provider.sendStateless("ready");
            }
          },
          onClose: ({ event }) => {
            state.closed = event.code;
            ws.disconnect();
          },
        });
        const client = {
          provider,
          ws,
          doc,
          get ready() {
            return state.ready;
          },
          get closed() {
            return state.closed;
          },
        };
        clients.push(client);
        provider.attach();
        void ws.connect();
        await wait(() => client.ready);
      }
      expect(
        (
          await call("PUT", `/files/${fileId}/access-grants`, 0, {
            userId: users[2]!.id,
            permission: "read",
          })
        ).statusCode,
      ).toBe(200);
      await wait(() => clients[1]!.closed === 4003);
      expect(clients[0]!.closed).toBe(0);
      expect(
        (
          await call("POST", `/files/${fileId}/collaboration-ticket`, 2, {
            schemaVersion: 1,
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      for (const client of clients) {
        client.ws.disconnect();
        client.provider.destroy();
        client.ws.destroy();
        client.doc.destroy();
      }
    }
  });
  test("表格单文件授权支持外部编辑，降权实时断开连接", async () => {
    const created = await call("POST", `/spaces/${spaceId}/files`, 0, {
      kind: "sheet",
      name: "外部表格",
    });
    const id = created.json().id as string;
    await call("PUT", `/files/${id}/access-grants`, 0, {
      userId: users[2]!.id,
      permission: "edit",
    });
    const ticket = await call("POST", `/files/${id}/collaboration-ticket`, 2, {
      schemaVersion: 1,
      editSessionId: "external-sheet-session-1",
    });
    expect(ticket.statusCode).toBe(200);
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/app/collaboration/sheets/${id}`,
    );
    let ready = false,
      closed = 0;
    ws.on("open", () =>
      ws.send(
        JSON.stringify({
          type: "auth",
          ticket: ticket.json().ticket,
          protocolVersion: 1,
          schemaVersion: 1,
        }),
      ),
    );
    ws.on("message", (bytes) => {
      const packet = JSON.parse(bytes.toString());
      if (packet.type === "snapshot") ready = true;
    });
    ws.on("close", (code) => {
      closed = code;
    });
    ws.on("error", () => {});
    try {
      await wait(() => ready);
      await call("PUT", `/files/${id}/access-grants`, 0, {
        userId: users[2]!.id,
        permission: "read",
      });
      await wait(() => closed === 4003);
      expect(
        (
          await call("POST", `/files/${id}/collaboration-ticket`, 2, {
            schemaVersion: 1,
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      ws.terminate();
    }
  });
  test("外部编辑者可上传目标文件图片，未提交图片不对匿名访客开放", async () => {
    await call("PUT", `/files/${fileId}/access-grants`, 0, {
      userId: users[2]!.id,
      permission: "edit",
    });
    const boundary = "minmd-access-upload-boundary";
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    );
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await app.inject({
      method: "POST",
      url: `/api/app/files/${fileId}/assets`,
      headers: {
        ...headers(2),
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(upload.statusCode).toBe(200);
    const assetId = upload.json().id as string;
    expect((await call("GET", `/assets/${assetId}`, 2)).rawPayload).toEqual(
      png,
    );
    expect((await call("GET", `/assets/${assetId}`, 3)).statusCode).toBe(403);
    await call("PUT", `/files/${fileId}/access-grants`, 0, {
      userId: users[3]!.id,
      permission: "edit",
    });
    expect((await call("GET", `/assets/${assetId}`, 3)).rawPayload).toEqual(png);
    await call("PUT", `/files/${fileId}/access-grants`, 0, {
      userId: users[3]!.id,
      permission: "read",
    });
    expect((await call("GET", `/assets/${assetId}`, 3)).statusCode).toBe(403);
    await call("DELETE", `/files/${fileId}/access-grants/${users[3]!.id}`);
    const shared = await call("PUT", `/files/${fileId}/share`, 0, {
      visibility: "public",
      audience: "anyone",
      permission: "read",
    });
    expect(
      (
        await app.inject(
          `/api/public/shares/${shared.json().token}/assets/${assetId}`,
        )
      ).statusCode,
    ).toBe(403);
    await call("DELETE", `/files/${fileId}/share`);
    await call("DELETE", `/files/${fileId}/access-grants/${users[2]!.id}`);
    expect((await call("GET", `/assets/${assetId}`, 2)).statusCode).toBe(403);
  });
  test("外部编辑不能通过正文引用窃取同空间其他文件的附件", async () => {
    await call("PUT", `/files/${fileId}/access-grants`, 0, {
      userId: users[2]!.id,
      permission: "edit",
    });
    const donor = await call("POST", `/spaces/${spaceId}/files`, 0, {
      kind: "doc",
      name: "未授权图片来源",
    });
    const donorId = donor.json().id as string;
    const boundary = "minmd-private-donor-boundary";
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    );
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="secret.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await app.inject({
      method: "POST",
      url: `/api/app/files/${donorId}/assets`,
      headers: {
        ...headers(),
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(upload.statusCode).toBe(200);
    const assetId = upload.json().id as string;
    expect((await call("GET", `/assets/${assetId}`, 2)).statusCode).toBe(403);
    const before = (await call("GET", `/files/${fileId}/content`, 2)).json();
    const attack = await call("POST", `/files/${fileId}/content-import`, 2, {
      expectedRevision: before.revision,
      expectedEpoch: before.epoch,
      projection: {
        type: "doc",
        content: [
          { type: "image", attrs: { src: upload.json().url, assetId } },
        ],
      },
    });
    expect(attack.statusCode).toBe(403);
    expect((await call("GET", `/files/${fileId}/content`, 2)).json()).toEqual(
      before,
    );
    expect((await call("GET", `/assets/${assetId}`, 2)).statusCode).toBe(403);
  });
});

(url ? test : test.skip)(
  "登录限定分享使用 app Cookie 路径，密码凭证覆盖两种分享入口且改密失效",
  async () => {
    const db = createDatabase(url!);
    const config = loadConfig({
      DATABASE_URL: url!,
      APP_ENV: "staging",
      WEB_CMS_DIST: "tests/fixtures/web-cms",
      WEB_DIST: "tests/fixtures/web",
      PUBLIC_ORIGIN: "http://127.0.0.1:9811",
      AUTH_TRANSPORT: "cookie",
      LOG_LEVEL: "silent",
    });
    const app = await buildApp(
      config,
      { logger: false },
      loadMinmdConfig(config, {}),
    );
    const ids: string[] = [];
    let spaceId: string | undefined;
    const accounts = `sharecookie_${Date.now()}`;
    try {
      const hash = await hashPassword("Share-cookie-test-123!");
      const sessions: { cookie: string; csrf: string }[] = [];
      for (const suffix of ["owner", "outside"]) {
        const [user] = await db.db
          .insert(appUsers)
          .values({
            account: `${accounts}_${suffix}`,
            nickname: suffix,
            passwordHash: hash,
          })
          .returning();
        ids.push(user!.id);
        const login = await app.inject({
          method: "POST",
          url: "/api/app/auth/login",
          payload: {
            account: user!.account,
            password: "Share-cookie-test-123!",
          },
        });
        expect(String(login.headers["set-cookie"])).toContain("Path=/api/app");
        sessions.push({
          cookie: login.cookies
            .map((cookie) => `${cookie.name}=${cookie.value}`)
            .join("; "),
          csrf: login.json().csrfToken,
        });
      }
      const headers = (index = 0, guest = "") => ({
        cookie: `${sessions[index]!.cookie}${guest ? `; ${guest}` : ""}`,
        origin: config.PUBLIC_ORIGIN,
        "x-csrf-token": sessions[index]!.csrf,
      });
      const space = await app.inject({
        method: "POST",
        url: "/api/app/spaces",
        headers: headers(),
        payload: { name: "登录路径验收" },
      });
      spaceId = space.json().id;
      const file = await app.inject({
        method: "POST",
        url: `/api/app/spaces/${spaceId}/files`,
        headers: headers(),
        payload: { kind: "doc", name: "登录限定文件" },
      });
      const id = file.json().id as string;
      const save = (payload: object) =>
        app.inject({
          method: "PUT",
          url: `/api/app/files/${id}/share`,
          headers: headers(),
          payload,
        });
      const share = await save({
        visibility: "public",
        audience: "authenticated",
        permission: "edit",
      });
      const token = share.json().token as string;
      expect(
        (await app.inject(`/api/public/shares/${token}/content`)).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            url: `/api/app/shares/${token}/content`,
            headers: headers(1),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/app/shares/${token}/accept`,
            headers: headers(1),
            payload: {},
          })
        ).json().permission,
      ).toBe("edit");
      await save({
        visibility: "public",
        audience: "authenticated",
        permission: "edit",
        password: "safe-pass",
      });
      expect(
        (
          await app.inject({
            url: `/api/app/shares/${token}/content`,
            headers: headers(1),
          })
        ).statusCode,
      ).toBe(403);
      const unlocked = await app.inject({
        method: "POST",
        url: `/api/app/shares/${token}/unlock`,
        headers: headers(1),
        payload: { password: "safe-pass" },
      });
      // 指定只读可绕过密码阅读，但绝不能凭这份只读授权取得公开编辑权限。
      await app.inject({
        method: "PUT",
        url: `/api/app/files/${id}/access-grants`,
        headers: headers(),
        payload: { userId: ids[1], permission: "read" },
      });
      expect(
        (
          await app.inject({
            url: `/api/app/shares/${token}/content`,
            headers: headers(1),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/app/shares/${token}/accept`,
            headers: headers(1),
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
      await app.inject({
        method: "DELETE",
        url: `/api/app/files/${id}/access-grants/${ids[1]}`,
        headers: headers(),
      });
      expect(unlocked.statusCode).toBe(200);
      const setCookie = String(unlocked.headers["set-cookie"]);
      expect(setCookie).toContain(`Path=/api/public/shares/${token}`);
      expect(setCookie).toContain(`Path=/api/app/shares/${token}`);
      const guest = unlocked.cookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");
      expect(
        (
          await app.inject({
            url: `/api/app/shares/${token}/content`,
            headers: headers(1, guest),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/app/shares/${token}/accept`,
            headers: headers(1, guest),
            payload: {},
          })
        ).statusCode,
      ).toBe(200);
      await save({
        visibility: "public",
        audience: "authenticated",
        permission: "edit",
        password: "new-pass",
      });
      expect(
        (
          await app.inject({
            url: `/api/app/shares/${token}/content`,
            headers: headers(1, guest),
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/app/shares/${token}/accept`,
            headers: headers(1, guest),
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await app.close();
      if (spaceId) {
        await db.db.delete(files).where(eq(files.spaceId, spaceId));
        await db.db.delete(spaces).where(eq(spaces.id, spaceId));
      }
      if (ids.length)
        await db.db.delete(appUsers).where(inArray(appUsers.id, ids));
      await db.close();
    }
  },
);
