import { afterAll, beforeAll, describe, test, expect } from "bun:test";
import { eq, like, desc } from "drizzle-orm";
import * as Y from "yjs";
import WebSocket from "ws";
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import { buildApp } from "../../apps/app_server/src/app";
import { appUsers } from "../../apps/app_server/src/database/schema/users";
import { files } from "../../apps/app_server/src/database/schema/files";
import { spaces } from "../../apps/app_server/src/database/schema/spaces";
import {
  fileContents,
  fileVersions,
} from "../../apps/app_server/src/database/schema/contents";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import { loadMinmdConfig } from "../../config/minmd";
import { hashPassword } from "../../system/server/src/modules/auth/password";
import {
  snapshotContains,
  DocumentRooms,
} from "../../apps/app_server/src/modules/collaboration/document-room";
import { assets } from "../../apps/app_server/src/database/schema/assets";
import { storeAsset } from "../../apps/app_server/src/modules/assets/service";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw new Error("正式协作协议测试只能使用独立_test库");
const wait = async (fn: () => boolean, label = "状态同步") => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > 8000) throw Error(`等待超时：${label}`);
    await Bun.sleep(10);
  }
};
interface Client {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  ws: HocuspocusProviderWebsocket;
  messages: Record<string, unknown>[];
  synced: boolean;
  failure: string;
  closed: number;
}
(url ? describe : describe.skip)("正式文档协作身份、持久化、世代与上限", () => {
  const db = createDatabase(url ?? "postgresql://localhost/unused_test");
  const prefix = `docprotocol_${Date.now()}`;
  const password = "Doc-protocol-test-123!";
  let app: Awaited<ReturnType<typeof buildApp>>;
  let aToken: string, bToken: string, bid: string;
  let spaceId: string, fileId: string, port: number;
  const clients: Client[] = [];
  const assetDirectories: string[] = [];
  const headers = (token = aToken) => ({ authorization: `Bearer ${token}` });
  const ticket = async (token = aToken) => {
    const r = await app.inject({
      method: "POST",
      url: `/api/app/files/${fileId}/collaboration-ticket`,
      headers: headers(token),
      payload: { schemaVersion: 1 },
    });
    expect(r.statusCode).toBe(200);
    return r.json().ticket as string;
  };
  const connect = async (token = aToken, supplied?: string) => {
    const doc = new Y.Doc();
    const ws = new HocuspocusProviderWebsocket({
      url: `ws://127.0.0.1:${port}/api/app/collaboration/documents/${fileId}`,
      WebSocketPolyfill: WebSocket,
      autoConnect: false,
    });
    const client = {
      doc,
      ws,
      messages: [],
      synced: false,
      failure: "",
      closed: 0,
    } as unknown as Client;
    const provider = new HocuspocusProvider({
      name: fileId,
      document: doc,
      websocketProvider: ws,
      token: supplied ?? (await ticket(token)),
      onSynced: ({ state }) => {
        client.synced = state;
        if (state) provider.sendStateless("ready");
      },
      onAuthenticationFailed: ({ reason }) => {
        client.failure = reason;
        ws.disconnect();
      },
      onStateless: ({ payload }) => {
        client.messages.push(JSON.parse(payload) as Record<string, unknown>);
      },
      onClose: ({ event }) => {
        client.closed = event.code;
        ws.disconnect();
      },
    });
    client.provider = provider;
    clients.push(client);
    provider.attach();
    void ws.connect();
    await wait(
      () => client.synced || !!client.failure || !!client.closed,
      "协作认证",
    );
    return client;
  };
  const stop = (client: Client) => {
    client.provider.destroy();
    client.ws.destroy();
    client.doc.destroy();
  };
  const text = (client: Client) => {
    const paragraph = client.doc.getXmlFragment("default").get(0);
    if (!(paragraph instanceof Y.XmlElement)) throw Error("段落未加载");
    let item = paragraph.get(0);
    if (!(item instanceof Y.XmlText)) {
      item = new Y.XmlText();
      paragraph.insert(0, [item]);
    }
    return item as Y.XmlText;
  };
  beforeAll(async () => {
    const hash = await hashPassword(password);
    const users = await db.db
      .insert(appUsers)
      .values(
        ["a", "b"].map((suffix) => ({
          account: `${prefix}_${suffix}`,
          passwordHash: hash,
        })),
      )
      .returning();
    bid = users[1]!.id;
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
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw Error("监听失败");
    port = address.port;
    const login = async (suffix: string) => {
      const r = await app.inject({
        method: "POST",
        url: "/api/app/auth/login",
        payload: { account: `${prefix}_${suffix}`, password },
      });
      expect(r.statusCode).toBe(200);
      return r.json().token as string;
    };
    aToken = await login("a");
    bToken = await login("b");
    const s = await app.inject({
      method: "POST",
      url: "/api/app/spaces",
      headers: headers(),
      payload: { name: prefix },
    });
    spaceId = s.json().id;
    await app.inject({
      method: "POST",
      url: `/api/app/spaces/${spaceId}/members`,
      headers: headers(),
      payload: { userId: bid },
    });
    const f = await app.inject({
      method: "POST",
      url: `/api/app/spaces/${spaceId}/files`,
      headers: headers(),
      payload: { kind: "doc", name: "实时协作" },
    });
    expect(f.statusCode).toBe(200);
    fileId = f.json().id;
    // 协作协议验收需要两个编辑者，不依赖新文件的默认只读权限。
    const grant = await app.inject({
      method: "PUT",
      url: `/api/app/files/${fileId}/member-permission`,
      headers: headers(),
      payload: { permission: "edit" },
    });
    expect(grant.statusCode).toBe(200);
  });
  afterAll(async () => {
    for (const client of clients) stop(client);
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
    for (const directory of assetDirectories)
      await rm(directory, { recursive: true, force: true });
  });
  test("同位置并发收敛、个人撤销、持久ACK包含删除和手动版本", async () => {
    const a = await connect(),
      b = await connect(bToken);
    expect(a.synced && b.synced).toBe(true);
    await wait(
      () =>
        a.messages.some(
          (message) =>
            message.type === "saved" &&
            Array.isArray(message.snapshot) &&
            Y.equalSnapshots(
              Y.snapshot(a.doc),
              Y.decodeSnapshot(Uint8Array.from(message.snapshot as number[])),
            ),
        ),
      "初始严格持久快照确认",
    );
    const ta = text(a);
    await wait(() => {
      const p = b.doc.getXmlFragment("default").get(0);
      return p instanceof Y.XmlElement && p.get(0) instanceof Y.XmlText;
    });
    const tb = text(b);
    const origin = Symbol("个人输入");
    const undo = new Y.UndoManager(a.doc.getXmlFragment("default"), {
      trackedOrigins: new Set([origin]),
    });
    a.doc.transact(() => ta.insert(0, "A"), origin);
    b.doc.transact(() => tb.insert(0, "B"), "b");
    await wait(
      () => ta.toString() === tb.toString() && ta.length === 2,
      "同位置输入收敛",
    );
    undo.undo();
    await wait(
      () => ta.toString() === "B" && tb.toString() === "B",
      "个人撤销",
    );
    undo.destroy();
    await wait(
      () =>
        a.messages.some(
          (message) =>
            message.type === "saved" &&
            Array.isArray(message.snapshot) &&
            snapshotContains(
              Y.snapshot(a.doc),
              Y.decodeSnapshot(Uint8Array.from(message.snapshot as number[])),
            ),
        ),
      "包含撤销删除的持久确认",
    );
    const saved = await app.inject({
      method: "POST",
      url: `/api/app/files/${fileId}/checkpoint`,
      headers: headers(),
      payload: {
        snapshot: Array.from(Y.encodeSnapshot(Y.snapshot(a.doc))),
        manual: true,
        note: "手动同步版本",
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().versionId).toBeString();
    const annotated = await app.inject({
      method: "PATCH",
      url: `/api/app/files/${fileId}/versions/${saved.json().versionId}`,
      headers: headers(bToken),
      payload: { note: "成员更新手动版本备注" },
    });
    expect(annotated.statusCode).toBe(200);
    const annotatedPreview = await app.inject({
      url: `/api/app/files/${fileId}/versions/${saved.json().versionId}`,
      headers: headers(),
    });
    expect(annotatedPreview.statusCode).toBe(200);
    expect(annotatedPreview.json().version.note).toBe("成员更新手动版本备注");
    const [state] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    expect(state!.projectionRevision).toBe(state!.revision);
    expect(JSON.stringify(state!.projection)).toContain('"text":"B"');
    const oldSnapshot = Array.from(Y.encodeSnapshot(Y.snapshot(a.doc)));
    b.doc.transact(() => tb.insert(tb.length, "C"), "b");
    await wait(() => ta.toString() === "BC");
    const ahead = await app.inject({
      method: "POST",
      url: `/api/app/files/${fileId}/checkpoint`,
      headers: headers(),
      payload: { snapshot: oldSnapshot, manual: true },
    });
    expect(ahead.statusCode).toBe(200);
    stop(a);
    stop(b);
  });
  test("真实连接突发消息在进入异步鉴权前被限制，断开后可重新认证", async () => {
    const client = await connect();
    expect(client.synced).toBe(true);
    for (let i = 0; i < 130; i++) client.provider.sendStateless("ready");
    await wait(() => client.closed === 4029, "文档突发频率关闭");
    stop(client);
    const next = await connect();
    expect(next.synced).toBe(true);
    stop(next);
  });
  test("十个已认证编辑会话，第十一个拒绝，断开释放并重新认证", async () => {
    const active: Client[] = [];
    const memberCount = (client: Client) =>
      [...client.messages]
        .reverse()
        .find((message) => message.type === "members")?.count;
    try {
      for (let i = 0; i < 10; i++) {
        const client = await connect();
        active.push(client);
        expect(client.synced).toBe(true);
        // 客户端 destroy 不代表服务端 close 已处理；按真实成员广播等待前一用例释放。
        if (i === 0)
          await wait(() => memberCount(client) === 1, "前序连接服务端释放");
      }
      const denied = await connect();
      expect(denied.synced).toBe(false);
      expect(`${denied.failure} ${denied.closed}`).toMatch(/10|4008/);
      stop(denied);
      stop(active[0]!);
      await wait(() => memberCount(active[1]!) === 9, "服务端名额释放广播");
      const replacement = await connect();
      active.push(replacement);
      expect(replacement.synced).toBe(true);
    } finally {
      for (const client of active) stop(client);
      await Bun.sleep(30);
    }
  });
  const settledPair = async () => {
    const a = await connect(),
      b = await connect(bToken);
    await wait(
      () =>
        a.messages.some((m) => m.type === "ready") &&
        b.messages.some((m) => m.type === "ready"),
      "双方初始化完成",
    );
    const ta = text(a);
    await wait(() => {
      const paragraph = b.doc.getXmlFragment("default").get(0);
      return (
        paragraph instanceof Y.XmlElement &&
        paragraph.get(0) instanceof Y.XmlText
      );
    });
    const tb = text(b);
    const checkpoint = await app.inject({
      method: "POST",
      url: `/api/app/files/${fileId}/checkpoint`,
      headers: headers(),
      payload: { snapshot: Array.from(Y.encodeSnapshot(Y.snapshot(a.doc))) },
    });
    expect(checkpoint.statusCode).toBe(200);
    return { a, b, ta, tb, revision: checkpoint.json().revision as number };
  };
  const confirmed = (client: Client) =>
    client.messages.some(
      (message) =>
        message.type === "saved" &&
        Array.isArray(message.snapshot) &&
        snapshotContains(
          Y.snapshot(client.doc),
          Y.decodeSnapshot(Uint8Array.from(message.snapshot as number[])),
        ),
    );
  test("500ms防抖合并两人突发输入，即时广播先于持久ACK", async () => {
    const { a, b, ta, tb, revision } = await settledPair();
    try {
      for (let i = 0; i < 3; i++) {
        ta.insert(ta.length, "甲");
        tb.insert(tb.length, "乙");
      }
      await wait(
        () =>
          ta.toString() === tb.toString() &&
          ta.toString().includes("甲") &&
          ta.toString().includes("乙"),
        "即时协作广播",
      );
      await Bun.sleep(200);
      const [pending] = await db.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId));
      expect(pending!.revision).toBe(revision);
      expect(confirmed(a)).toBe(false);
      expect(confirmed(b)).toBe(false);
      await wait(() => confirmed(a) && confirmed(b), "合并批次持久确认");
      const [saved] = await db.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId));
      expect(saved!.revision).toBe(revision + 1);
      expect(JSON.stringify(saved!.projection)).toContain("甲");
      expect(JSON.stringify(saved!.projection)).toContain("乙");
    } finally {
      stop(a);
      stop(b);
    }
  });
  test("持续双端输入也在2秒截止触发保存，最后一批确认覆盖完整内容", async () => {
    const { a, b, ta, tb, revision } = await settledPair();
    let firstSaved = 0;
    const start = Date.now();
    const observe = ({ payload }: { payload: string }) => {
      const message = JSON.parse(payload) as {
        type: string;
        revision?: number;
      };
      if (
        !firstSaved &&
        message.type === "saved" &&
        (message.revision ?? 0) > revision
      )
        firstSaved = Date.now();
    };
    a.provider.on("stateless", observe);
    try {
      let index = 0;
      while (Date.now() - start < 2800) {
        const item = index++ % 2 ? tb : ta;
        item.insert(item.length, "续");
        await Bun.sleep(120);
      }
      expect(firstSaved - start).toBeGreaterThanOrEqual(1400);
      expect(firstSaved - start).toBeLessThan(2500);
      await wait(
        () => ta.toString() === tb.toString() && confirmed(a) && confirmed(b),
        "连续输入最终确认",
      );
      const [saved] = await db.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId));
      expect(saved!.revision).toBeGreaterThan(revision);
      expect(saved!.revision - revision).toBeLessThanOrEqual(3);
      const copy = new Y.Doc();
      try {
        Y.applyUpdate(copy, saved!.documentState!);
        expect(Y.equalSnapshots(Y.snapshot(copy), Y.snapshot(a.doc))).toBe(
          true,
        );
      } finally {
        copy.destroy();
      }
    } finally {
      a.provider.off("stateless", observe);
      stop(a);
      stop(b);
    }
  }, 10000);
  test("防抖期间手动保存立即提交双方更新并创建可回读版本", async () => {
    const { a, b, ta, tb, revision } = await settledPair();
    try {
      ta.insert(ta.length, "手动甲");
      tb.insert(tb.length, "手动乙");
      await wait(
        () =>
          ta.toString() === tb.toString() && ta.toString().includes("手动乙"),
      );
      const start = Date.now();
      const checkpoint = await app.inject({
        method: "POST",
        url: `/api/app/files/${fileId}/checkpoint`,
        headers: headers(),
        payload: {
          snapshot: Array.from(Y.encodeSnapshot(Y.snapshot(a.doc))),
          manual: true,
          note: "防抖期间手动保存",
        },
      });
      expect(checkpoint.statusCode).toBe(200);
      expect(Date.now() - start).toBeLessThan(450);
      expect(checkpoint.json().revision).toBe(revision + 1);
      const preview = await app.inject({
        url: `/api/app/files/${fileId}/versions/${checkpoint.json().versionId}`,
        headers: headers(),
      });
      expect(preview.statusCode).toBe(200);
      expect(JSON.stringify(preview.json())).toContain("手动甲");
      expect(JSON.stringify(preview.json())).toContain("手动乙");
      await wait(() => confirmed(a) && confirmed(b), "手动保存广播持久确认");
    } finally {
      stop(a);
      stop(b);
    }
  });
  test("写入期间的新输入不被旧ACK冒充确认，随后独立落库", async () => {
    const { a, b, ta, tb, revision } = await settledPair();
    const blocker = await db.pool.connect();
    let locked = false;
    try {
      await blocker.query("BEGIN");
      locked = true;
      await blocker.query(
        "SELECT file_id FROM file_contents WHERE file_id = $1 FOR UPDATE",
        [fileId],
      );
      const at = a.messages.length;
      ta.insert(ta.length, "前批");
      await wait(() => tb.toString().includes("前批"));
      await Bun.sleep(650);
      tb.insert(tb.length, "后批");
      await wait(
        () => ta.toString() === tb.toString() && ta.toString().includes("后批"),
      );
      expect(confirmed(a)).toBe(false);
      await blocker.query("COMMIT");
      locked = false;
      await wait(
        () =>
          a.messages
            .slice(at)
            .some((m) => m.type === "saved" && Number(m.revision) > revision),
        "第一批保存确认",
      );
      const first = a.messages
        .slice(at)
        .find((m) => m.type === "saved" && Number(m.revision) > revision)!;
      expect(
        snapshotContains(
          Y.snapshot(a.doc),
          Y.decodeSnapshot(Uint8Array.from(first.snapshot as number[])),
        ),
      ).toBe(false);
      await wait(() => confirmed(a) && confirmed(b), "第二批独立确认");
      const [saved] = await db.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId));
      expect(saved!.revision).toBe(revision + 2);
      expect(JSON.stringify(saved!.projection)).toContain("后批");
    } finally {
      if (locked) await blocker.query("ROLLBACK");
      blocker.release();
      stop(a);
      stop(b);
    }
  });
  test("防抖期间导入先落库，拒绝过期基线且旧计时器不会覆盖新世代", async () => {
    const { a, b, ta, tb, revision } = await settledPair();
    try {
      ta.insert(ta.length, "切换前待保存");
      await wait(() => tb.toString().includes("切换前待保存"));
      const [initial] = await db.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId));
      const projection = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "切换后的正文" }],
          },
        ],
      };
      const stale = await app.inject({
        method: "POST",
        url: `/api/app/files/${fileId}/content-import`,
        headers: headers(),
        payload: {
          expectedRevision: revision,
          expectedEpoch: initial!.epoch,
          projection,
        },
      });
      expect(stale.statusCode).toBe(409);
      const [flushed] = await db.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId));
      expect(JSON.stringify(flushed!.projection)).toContain("切换前待保存");
      expect(flushed!.revision).toBe(revision + 1);
      const imported = await app.inject({
        method: "POST",
        url: `/api/app/files/${fileId}/content-import`,
        headers: headers(),
        payload: {
          expectedRevision: flushed!.revision,
          expectedEpoch: flushed!.epoch,
          projection,
        },
      });
      expect(imported.statusCode).toBe(200);
      await wait(
        () => a.closed === 4009 && b.closed === 4009,
        "世代切换关闭旧会话",
      );
      await Bun.sleep(700);
      const [current] = await db.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId));
      expect(current!.epoch).toBe(flushed!.epoch + 1);
      expect(JSON.stringify(current!.projection)).toContain("切换后的正文");
      expect(JSON.stringify(current!.projection)).not.toContain("切换前待保存");
      const fresh = await connect();
      try {
        expect(fresh.doc.getXmlFragment("default").toJSON()).toContain(
          "切换后的正文",
        );
      } finally {
        stop(fresh);
      }
    } finally {
      stop(a);
      stop(b);
    }
  });
  test("未提交批次贡献者被撤权时不越权落库，负责人能从权威状态重新进入", async () => {
    const { a, b, ta, tb, revision } = await settledPair();
    try {
      ta.insert(ta.length, "权限撤销甲");
      tb.insert(tb.length, "权限撤销乙");
      await wait(
        () =>
          ta.toString() === tb.toString() &&
          ta.toString().includes("权限撤销乙"),
      );
      const removed = await app.inject({
        method: "DELETE",
        url: `/api/app/spaces/${spaceId}/members/${bid}`,
        headers: headers(),
      });
      expect(removed.statusCode).toBe(200);
      await wait(
        () => b.closed === 4003 && a.closed === 4009,
        "失效批次隔离并保留客户端未确认状态",
      );
      const [saved] = await db.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId));
      expect(saved!.revision).toBe(revision);
      expect(JSON.stringify(saved!.projection)).not.toContain("权限撤销乙");
      const fresh = await connect();
      try {
        expect(fresh.doc.getXmlFragment("default").toJSON()).not.toContain(
          "权限撤销甲",
        );
      } finally {
        stop(fresh);
      }
    } finally {
      stop(a);
      stop(b);
      const restored = await app.inject({
        method: "POST",
        url: `/api/app/spaces/${spaceId}/members`,
        headers: headers(),
        payload: { userId: bid },
      });
      expect(restored.statusCode).toBe(200);
    }
  });
  test("数据库拒绝提交时不发持久ACK，重试成功后才提高修订", async () => {
    const a = await connect();
    const ta = text(a);
    await Bun.sleep(40);
    const [before] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    const trigger = `doc_fail_${Date.now()}`;
    await db.pool.query(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.file_id = '${fileId}'::uuid THEN RAISE EXCEPTION 'fixture save failure'; END IF; RETURN NEW; END $$`,
    );
    await db.pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON document_updates FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
    );
    const messagesAt = a.messages.length;
    try {
      a.doc.transact(() => ta.insert(ta.length, "未确认"), "failure-test");
      await wait(
        () =>
          a.messages
            .slice(messagesAt)
            .some((message) => message.type === "error"),
        "数据库失败通知",
      );
      const [failed] = await db.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId));
      expect(failed!.revision).toBe(before!.revision);
      expect(JSON.stringify(failed!.projection)).not.toContain("未确认");
      expect(
        a.messages
          .slice(messagesAt)
          .some(
            (message) =>
              message.type === "saved" &&
              Array.isArray(message.snapshot) &&
              snapshotContains(
                Y.snapshot(a.doc),
                Y.decodeSnapshot(Uint8Array.from(message.snapshot as number[])),
              ),
          ),
      ).toBe(false);
    } finally {
      await db.pool.query(
        `DROP TRIGGER IF EXISTS ${trigger} ON document_updates`,
      );
      await db.pool.query(`DROP FUNCTION IF EXISTS ${trigger}()`);
    }
    await wait(() => confirmed(a), "数据库恢复后自动重试，不需再次输入");
    const saved = await app.inject({
      method: "POST",
      url: `/api/app/files/${fileId}/checkpoint`,
      headers: headers(),
      payload: {
        snapshot: Array.from(Y.encodeSnapshot(Y.snapshot(a.doc))),
        manual: true,
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().revision).toBeGreaterThan(before!.revision);
    const [retried] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    expect(JSON.stringify(retried!.projection)).toContain("未确认");
    stop(a);
  });
  test("恶意Origin、URL凭证和无效协作文档节点被拒绝", async () => {
    for (const options of [
      { origin: "http://untrusted.invalid", suffix: "" },
      { origin: undefined, suffix: "?ticket=unsafe-url-token" },
    ]) {
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/api/app/collaboration/documents/${fileId}${options.suffix}`,
        { headers: options.origin ? { origin: options.origin } : {} },
      );
      const closed = await new Promise<number>((resolve, reject) => {
        socket.once("close", (code) => resolve(code));
        socket.once("error", reject);
      });
      expect(closed).toBe(4003);
    }
    const client = await connect();
    const [before] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    client.doc
      .getXmlFragment("default")
      .insert(0, [new Y.XmlElement("unsupported_node")]);
    await wait(() => client.closed === 4003, "无效协作Schema拒绝");
    const [after] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    expect(after!.revision).toBe(before!.revision);
    expect(JSON.stringify(after!.projection)).not.toContain("unsupported_node");
    stop(client);
  });
  test("服务端补齐缺失和重复块ID，保留用户正文且提供持久ACK", async () => {
    const client = await connect();
    const root = client.doc.getXmlFragment("default");
    const original = root.get(0);
    if (!(original instanceof Y.XmlElement)) throw Error("初始段落不存在");
    const duplicate = original.getAttribute("blockId");
    const missing = new Y.XmlElement("paragraph");
    const repeated = new Y.XmlElement("paragraph");
    if (duplicate) repeated.setAttribute("blockId", duplicate);
    const first = new Y.XmlText();
    first.insert(0, "服务端分配ID");
    missing.insert(0, [first]);
    repeated.insert(0, [new Y.XmlText("重复ID正文")]);
    client.doc.transact(() => root.insert(root.length, [missing, repeated]));
    await wait(
      () =>
        !!missing.getAttribute("blockId") &&
        repeated.getAttribute("blockId") !== duplicate,
      "稳定块ID回传",
    );
    await wait(
      () =>
        client.messages.some(
          (message) =>
            message.type === "saved" &&
            Array.isArray(message.snapshot) &&
            snapshotContains(
              Y.snapshot(client.doc),
              Y.decodeSnapshot(Uint8Array.from(message.snapshot as number[])),
            ),
        ),
      "补ID持久ACK",
    );
    const [saved] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    const projection = JSON.stringify(saved!.projection);
    expect(projection).toContain("服务端分配ID");
    expect(projection).toContain("重复ID正文");
    expect(missing.getAttribute("blockId")).not.toBe(
      repeated.getAttribute("blockId"),
    );
    expect(projection).toContain(missing.getAttribute("blockId")!);
    stop(client);
  });
  test("自动版本五分钟边界使用实际周期入口，有变化生成且无变化不重复", async () => {
    const client = await connect();
    const currentText = text(client);
    client.doc.transact(() =>
      currentText.insert(currentText.length, "自动版本边界正文"),
    );
    await wait(
      () =>
        client.messages.some(
          (message) =>
            message.type === "saved" &&
            Array.isArray(message.snapshot) &&
            snapshotContains(
              Y.snapshot(client.doc),
              Y.decodeSnapshot(Uint8Array.from(message.snapshot as number[])),
            ),
        ),
      "自动版本测试持久确认",
    );
    const config = loadConfig({
      DATABASE_URL: url!,
      APP_ENV: "staging",
      AUTH_TRANSPORT: "bearer",
      LOG_LEVEL: "silent",
    });
    const periodic = new DocumentRooms(db, config);
    const query = () =>
      db.db
        .select()
        .from(fileVersions)
        .where(eq(fileVersions.fileId, fileId))
        .orderBy(desc(fileVersions.createdAt));
    const ageVersions = async (milliseconds: number) => {
      const rows = await query();
      const now = Date.now();
      for (const [index, row] of rows.entries())
        await db.db
          .update(fileVersions)
          .set({ createdAt: new Date(now - milliseconds - index * 1000) })
          .where(eq(fileVersions.id, row.id));
    };
    try {
      const before = await query();
      await ageVersions(5 * 60000 - 1000);
      await periodic.runPeriodicVersions([fileId]);
      expect(await query()).toHaveLength(before.length);
      await ageVersions(5 * 60000 + 1000);
      await periodic.runPeriodicVersions([fileId]);
      const after = await query();
      expect(after).toHaveLength(before.length + 1);
      expect(after[0]!.source).toBe("auto");
      expect(JSON.stringify(after[0]!.projection)).toContain(
        "自动版本边界正文",
      );
      await ageVersions(6 * 60000);
      await periodic.runPeriodicVersions([fileId]);
      expect(await query()).toHaveLength(after.length);
    } finally {
      await periodic.close();
      stop(client);
    }
  });
  test("两个真实编辑端并发修改图片宽度和对齐，稳定附件与块ID保留", async () => {
    const directory = await mkdtemp(join(tmpdir(), "minmd-image-collab-test-"));
    assetDirectories.push(directory);
    const [space] = await db.db
      .select()
      .from(spaces)
      .where(eq(spaces.id, spaceId));
    const image = await storeAsset(
      db,
      directory,
      space!.ownerId,
      spaceId,
      "concurrent.png",
      "image/png",
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const original = (
      await app.inject({
        url: `/api/app/files/${fileId}/content`,
        headers: headers(),
      })
    ).json();
    const imported = await app.inject({
      method: "POST",
      url: `/api/app/files/${fileId}/content-import`,
      headers: headers(),
      payload: {
        expectedRevision: original.revision,
        expectedEpoch: original.epoch,
        projection: {
          type: "doc",
          content: [
            ...original.projection.content,
            {
              type: "image",
              attrs: {
                assetId: image.id,
                src: image.url,
                width: "200",
                align: "left",
              },
            },
          ],
        },
      },
    });
    expect(imported.statusCode).toBe(200);
    const a = await connect(),
      b = await connect(bToken);
    try {
      const imageA = a.doc
        .getXmlFragment("default")
        .toArray()
        .find(
          (node) => node instanceof Y.XmlElement && node.nodeName === "image",
        );
      const imageB = b.doc
        .getXmlFragment("default")
        .toArray()
        .find(
          (node) => node instanceof Y.XmlElement && node.nodeName === "image",
        );
      if (
        !(imageA instanceof Y.XmlElement) ||
        !(imageB instanceof Y.XmlElement)
      )
        throw Error("图片未同步到双端");
      const blockId = imageA.getAttribute("blockId");
      a.doc.transact(() => imageA.setAttribute("width", "420"), "a-image");
      b.doc.transact(() => imageB.setAttribute("align", "right"), "b-image");
      await wait(
        () =>
          [imageA, imageB].every(
            (node) =>
              node.getAttribute("width") === "420" &&
              node.getAttribute("align") === "right",
          ),
        "图片属性并发收敛",
      );
      expect(imageA.getAttribute("assetId")).toBe(image.id);
      expect(imageB.getAttribute("assetId")).toBe(image.id);
      expect(imageA.getAttribute("blockId")).toBe(blockId);
      expect(imageB.getAttribute("blockId")).toBe(blockId);
      const checkpoint = await app.inject({
        method: "POST",
        url: `/api/app/files/${fileId}/checkpoint`,
        headers: headers(),
        payload: {
          manual: true,
          snapshot: Array.from(Y.encodeSnapshot(Y.snapshot(a.doc))),
        },
      });
      expect(checkpoint.statusCode).toBe(200);
      const persisted = (
        await app.inject({
          url: `/api/app/files/${fileId}/content`,
          headers: headers(),
        })
      ).json();
      expect(
        persisted.projection.content.find(
          (node: { type: string }) => node.type === "image",
        ).attrs,
      ).toMatchObject({
        width: "420",
        align: "right",
        blockId,
        assetId: image.id,
      });
      expect(a.doc.getXmlFragment("default").toJSON()).toBe(
        b.doc.getXmlFragment("default").toJSON(),
      );
    } finally {
      stop(a);
      stop(b);
    }
  });
  test("AI HTTP原子写入广播到两个真实在线编辑端并生成持久历史", async () => {
    const a = await connect(),
      b = await connect(bToken);
    try {
      const issued = await app.inject({
        method: "POST",
        url: `/api/app/spaces/${spaceId}/api-keys`,
        headers: headers(),
        payload: { name: "在线AI验收", permissions: ["read", "edit"] },
      });
      expect(issued.statusCode).toBe(200);
      const credential = headers(issued.json().secret);
      const current = await app.inject({
        url: `/api/v1/files/${fileId}/document`,
        headers: credential,
      });
      expect(current.statusCode).toBe(200);
      const input = {
        requestId: `${prefix}_broadcast`,
        expectedRevision: current.json().revision,
        expectedEpoch: current.json().epoch,
        operations: [{ type: "insert_blocks", markdown: "**AI在线广播内容**" }],
      };
      const written = await app.inject({
        method: "PATCH",
        url: `/api/v1/files/${fileId}/document`,
        headers: credential,
        payload: input,
      });
      expect(written.statusCode).toBe(200);
      await wait(
        () =>
          [a, b].every((client) =>
            JSON.stringify(
              client.doc.getXmlFragment("default").toJSON(),
            ).includes("AI在线广播内容"),
          ),
        "AI广播双端",
      );
      expect(a.doc.getXmlFragment("default").toJSON()).toBe(
        b.doc.getXmlFragment("default").toJSON(),
      );
      const [saved] = await db.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId));
      expect(saved!.revision).toBe(written.json().revision);
      expect(JSON.stringify(saved!.projection)).toContain("AI在线广播内容");
      const preview = await app.inject({
        url: `/api/app/files/${fileId}/versions/${written.json().versionId}`,
        headers: headers(),
      });
      expect(preview.statusCode).toBe(200);
      expect(preview.json().version.source).toBe("ai");
      expect(JSON.stringify(preview.json().projection)).toContain(
        "AI在线广播内容",
      );
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: `/api/v1/files/${fileId}/document`,
            headers: credential,
            payload: input,
          })
        ).body,
      ).toBe(written.body);
      expect(
        (
          JSON.stringify(a.doc.getXmlFragment("default").toJSON()).match(
            /AI在线广播内容/g,
          ) ?? []
        ).length,
      ).toBe(1);
      const block = saved!.projection as {
        content: {
          attrs: { blockId: string };
          content?: { text?: string }[];
        }[];
      };
      const target = block.content.find((node) =>
        node.content?.some((text) => text.text === "AI在线广播内容"),
      )!;
      const replaced = await app.inject({
        method: "PATCH",
        url: `/api/v1/files/${fileId}/document`,
        headers: credential,
        payload: {
          expectedRevision: written.json().revision,
          expectedEpoch: written.json().epoch,
          requestId: `${prefix}_text`,
          operations: [
            {
              type: "replace_text",
              blockId: target.attrs.blockId,
              oldText: "AI在线广播内容",
              newText: "AI精确替换内容",
            },
          ],
        },
      });
      expect(replaced.statusCode).toBe(200);
      await wait(
        () =>
          [a, b].every((client) =>
            client.doc
              .getXmlFragment("default")
              .toJSON()
              .includes("AI精确替换内容"),
          ),
        "HTTP文字替换广播",
      );
      const typed = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          ...credential,
          host: new URL(
            loadMinmdConfig(loadConfig({ DATABASE_URL: url! }))
              .allowedOrigins[0]!,
          ).host,
          accept: "application/json, text/event-stream",
        },
        payload: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "update_document",
            arguments: {
              fileId,
              expectedRevision: replaced.json().revision,
              expectedEpoch: replaced.json().epoch,
              requestId: `${prefix}_type`,
              operations: [
                {
                  type: "set_block_type",
                  blockId: target.attrs.blockId,
                  nodeType: "heading",
                  attrs: { level: 2 },
                },
              ],
            },
          },
        },
      });
      expect(typed.statusCode).toBe(200);
      expect(typed.json().result.isError).not.toBe(true);
      const result = typed.json().result.structuredContent.result;
      await wait(
        () =>
          [a, b].every((client) =>
            client.doc
              .getXmlFragment("default")
              .toArray()
              .some(
                (node) =>
                  node instanceof Y.XmlElement &&
                  node.nodeName === "heading" &&
                  node.getAttribute("blockId") === target.attrs.blockId,
              ),
          ),
        "MCP块类型广播",
      );
      // 覆盖 Hocuspocus 的延迟 store 窗口，已提交 AI 广播不得产生第二次业务修订。
      await Bun.sleep(650);
      const [authoritative] = await db.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId));
      expect(authoritative!.revision).toBe(result.revision);
      expect(JSON.stringify(authoritative!.projection)).toContain(
        "AI精确替换内容",
      );
      for (const versionId of [replaced.json().versionId, result.versionId]) {
        const preview = await app.inject({
          url: `/api/app/files/${fileId}/versions/${versionId}`,
          headers: headers(),
        });
        expect(preview.json().version.source).toBe("ai");
        expect(JSON.stringify(preview.json().projection)).toContain(
          "AI精确替换内容",
        );
      }
      const ambiguous = await app.inject({
        method: "PATCH",
        url: `/api/v1/files/${fileId}/document`,
        headers: credential,
        payload: {
          expectedRevision: result.revision,
          expectedEpoch: result.epoch,
          requestId: `${prefix}_ambiguous_seed`,
          operations: [{ type: "insert_blocks", markdown: "重复 重复" }],
        },
      });
      expect(ambiguous.statusCode).toBe(200);
      const [beforeFailure] = await db.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId));
      const failureProjection = beforeFailure!.projection as {
        content: {
          attrs: { blockId: string };
          content?: { text?: string }[];
        }[];
      };
      const ambiguousBlock = failureProjection.content.find((node) =>
        node.content?.some((text) => text.text === "重复 重复"),
      )!;
      const historyBeforeFailure = await db.db
        .select()
        .from(fileVersions)
        .where(eq(fileVersions.fileId, fileId));
      for (const [index, oldText] of ["不在块里的文字", "重复"].entries()) {
        const denied = await app.inject({
          method: "PATCH",
          url: `/api/v1/files/${fileId}/document`,
          headers: credential,
          payload: {
            expectedRevision: beforeFailure!.revision,
            expectedEpoch: beforeFailure!.epoch,
            requestId: `${prefix}_text_failure_${index}`,
            operations: [
              { type: "insert_blocks", markdown: "失败批次不可写入" },
              {
                type: "replace_text",
                blockId: ambiguousBlock.attrs.blockId,
                oldText,
                newText: "不应该替换",
              },
            ],
          },
        });
        expect(denied.statusCode).toBe(409);
        expect(denied.json().code).toBe("TEXT_TARGET_INVALID");
        const [unchanged] = await db.db
          .select()
          .from(fileContents)
          .where(eq(fileContents.fileId, fileId));
        expect(unchanged!.revision).toBe(beforeFailure!.revision);
        expect(unchanged!.projection).toEqual(beforeFailure!.projection);
        expect(unchanged!.documentState).toEqual(beforeFailure!.documentState);
        expect(
          (
            await db.db
              .select()
              .from(fileVersions)
              .where(eq(fileVersions.fileId, fileId))
          )
            .map((version) => version.id)
            .sort(),
        ).toEqual(historyBeforeFailure.map((version) => version.id).sort());
      }
    } finally {
      stop(a);
      stop(b);
    }
  });
  test("成员撤销立即关闭连接，整体恢复隔离旧票据并拒绝旧命令", async () => {
    const a = await connect(),
      b = await connect(bToken);
    const oldTicket = await ticket();
    const saved = await app.inject({
      url: `/api/app/files/${fileId}/content`,
      headers: headers(),
    });
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/app/spaces/${spaceId}/members/${bid}`,
          headers: headers(),
        })
      ).statusCode,
    ).toBe(200);
    await wait(() => b.closed === 4003, "移除成员关闭协作");
    const imported = await app.inject({
      method: "POST",
      url: `/api/app/files/${fileId}/content-import`,
      headers: headers(),
      payload: {
        expectedRevision: saved.json().revision,
        expectedEpoch: saved.json().epoch,
        projection: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "新世代" }] },
          ],
        },
      },
    });
    expect(imported.statusCode).toBe(200);
    await wait(() => a.closed === 4009, "恢复前连接撤销");
    const rejected = await connect(aToken, oldTicket);
    expect(rejected.synced).toBe(false);
    const fresh = await connect();
    expect(
      JSON.stringify(fresh.doc.getXmlFragment("default").toJSON()),
    ).toContain("新世代");
    const stale = await app.inject({
      method: "POST",
      url: `/api/app/files/${fileId}/content-import`,
      headers: headers(),
      payload: {
        expectedRevision: saved.json().revision,
        expectedEpoch: saved.json().epoch,
        projection: { type: "doc", content: [{ type: "paragraph" }] },
      },
    });
    expect(stale.statusCode).toBe(409);
    stop(a);
    stop(b);
    stop(rejected);
    stop(fresh);
  });
  test("服务重启从PG权威状态恢复，退出登录立即撤销房间", async () => {
    const shutdownWriter = await connect();
    const shutdownPeer = await connect();
    const pendingText = text(shutdownWriter);
    pendingText.insert(pendingText.length, "停服前待确认");
    await wait(
      () =>
        shutdownPeer.doc
          .getXmlFragment("default")
          .toJSON()
          .includes("停服前待确认"),
      "停服前更新已到达服务端",
    );
    await app.close();
    const [flushed] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    expect(JSON.stringify(flushed!.projection)).toContain("停服前待确认");
    stop(shutdownWriter);
    stop(shutdownPeer);
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
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw Error("监听失败");
    port = address.port;
    const restored = await connect();
    expect(
      JSON.stringify(restored.doc.getXmlFragment("default").toJSON()),
    ).toContain("新世代");
    const result = await app.inject({
      method: "POST",
      url: "/api/app/auth/logout",
      headers: headers(),
      payload: {},
    });
    expect(result.statusCode).toBe(200);
    await wait(() => restored.closed === 4003, "退出登录关闭连接");
    stop(restored);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/app/files/${fileId}/collaboration-ticket`,
          headers: headers(),
          payload: { schemaVersion: 1 },
        })
      ).statusCode,
    ).toBe(401);
  });
});
