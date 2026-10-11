import { test, expect } from "bun:test";
import Fastify from "fastify";
import WebSocket from "ws";
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import * as Y from "yjs";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerDocumentVerification } from "../apps/app_server/src/modules/document-verification";
import { loadConfig } from "../system/server/src/config/env";
import { documentCollaborationConfig } from "../config/document-collaboration";
const wait = async (condition: () => boolean) => {
  const until = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > until) throw Error("等待文档协作消息超时");
    await Bun.sleep(10);
  }
};
test("文档会话上限默认 10，拒绝无效配置", () => {
  expect(documentCollaborationConfig({}).DOC_COLLAB_MAX_SESSIONS).toBe(10);
  expect(() =>
    documentCollaborationConfig({ DOC_COLLAB_MAX_SESSIONS: "0" }),
  ).toThrow();
});
test("Yjs 双端并发、个人撤销、断线重连、持久化和 10 会话上限", async () => {
  const dir = await mkdtemp(join(tmpdir(), "minmd-document-test-"));
  const previous = { ...process.env };
  process.env.DOC_COLLAB_VERIFY_ENABLED = "true";
  process.env.DOC_COLLAB_VERIFY_DIR = dir;
  process.env.DOC_COLLAB_MAX_SESSIONS = "10";
  const providers: HocuspocusProvider[] = [],
    raw: WebSocket[] = [];
  let app = Fastify({ forceCloseConnections: true });
  const config = loadConfig({
    ...process.env,
    APP_ENV: "development",
    HOST: "127.0.0.1",
    DATABASE_URL: "postgresql://localhost/unused_test",
  });
  try {
    const server = await registerDocumentVerification(app, config);
    if (!server) throw Error("验证服务未注册");
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw Error("端口不存在");
    const url = `ws://127.0.0.1:${addr.port}/api/experimental/documents/test`;
    const connect = async (name = "test") => {
      const document = new Y.Doc();
      const websocketProvider = new HocuspocusProviderWebsocket({
        url: url.replace(/test$/, name),
        WebSocketPolyfill: WebSocket,
      });
      const provider = new HocuspocusProvider({
        name,
        document,
        websocketProvider,
        token: "development-verification",
      });
      provider.attach();
      providers.push(provider);
      await wait(() => provider.synced);
      return provider;
    };
    const a = await connect(),
      b = await connect(),
      other = await connect("other");
    const persisted: Y.Snapshot[] = [];
    const claims: { provider: HocuspocusProvider; type: string }[] = [];
    for (const provider of [a, b])
      provider.on("stateless", ({ payload }: { payload: string }) => {
        const packet: { type: string; snapshot?: number[] } =
          JSON.parse(payload);
        claims.push({ provider, type: packet.type });
        if (provider === a && packet.type === "saved" && packet.snapshot)
          persisted.push(Y.decodeSnapshot(new Uint8Array(packet.snapshot)));
      });
    a.sendStateless("initialize");
    b.sendStateless("initialize");
    await wait(() => claims.some((item) => item.type === "initialize"));
    await Bun.sleep(20);
    expect(claims.filter((item) => item.type === "initialize").length).toBe(1);
    claims
      .find((item) => item.type === "initialize")!
      .provider.sendStateless("initialized");
    await wait(
      () => claims.filter((item) => item.type === "ready").length === 2,
    );
    const ta = a.document.getText("proof"),
      tb = b.document.getText("proof");
    const undo = new Y.UndoManager(ta, { trackedOrigins: new Set(["local"]) });
    a.document.transact(() => ta.insert(0, "A"), "local");
    b.document.transact(() => tb.insert(0, "B"), "local");
    await wait(() => ta.toString() === tb.toString() && ta.length === 2);
    expect(ta.toString()).toContain("A");
    expect(ta.toString()).toContain("B");
    expect(other.document.getText("proof").length).toBe(0);
    undo.undo();
    await wait(() => tb.toString() === "B");
    expect(ta.toString()).toBe("B");
    await wait(
      () =>
        Boolean(persisted.at(-1)) &&
        Y.equalSnapshots(persisted.at(-1)!, Y.snapshot(a.document)),
    );
    a.configuration.websocketProvider.disconnect();
    await Bun.sleep(30);
    b.document.transact(() => tb.insert(tb.length, "C"));
    await a.configuration.websocketProvider.connect();
    await wait(() => ta.toString() === "BC");
    const direct = await server.openDirectConnection("test", {
      fileId: "test",
    });
    await direct.transact((document) => {
      document.getText("proof").insert(2, "S");
    });
    await wait(() => ta.toString() === "BCS" && tb.toString() === "BCS");
    await direct.disconnect();
    for (let i = 0; i < 8; i++) {
      const ws = new WebSocket(url);
      raw.push(ws);
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", () => reject(Error("连接失败")));
      });
    }
    const full = new WebSocket(url);
    raw.push(full);
    const code = await new Promise<number>((resolve) =>
      full.once("close", (c) => resolve(c)),
    );
    expect(code).toBe(4008);
    raw[0].close();
    await Bun.sleep(40);
    const replacement = new WebSocket(url);
    raw.push(replacement);
    await new Promise<void>((resolve, reject) => {
      replacement.once("open", () => resolve());
      replacement.once("error", () => reject(Error("名额释放失败")));
    });
    await Bun.sleep(50);
    expect(replacement.readyState).toBe(WebSocket.OPEN);
    await app.close();
    const restored = new Y.Doc();
    Y.applyUpdate(restored, await readFile(join(dir, "test.yjs")));
    expect(restored.getText("proof").toString()).toBe("BCS");
    app = Fastify({ forceCloseConnections: true });
    await registerDocumentVerification(app, config);
    await app.listen({ port: addr.port, host: "127.0.0.1" });
    const c = await connect();
    expect(c.document.getText("proof").toString()).toBe("BCS");
    undo.destroy();
    restored.destroy();
  } finally {
    for (const p of providers) {
      p.destroy();
      p.configuration.websocketProvider.destroy();
      p.document.destroy();
    }
    for (const ws of raw) ws.terminate();
    await app.close();
    for (const key of [
      "DOC_COLLAB_VERIFY_ENABLED",
      "DOC_COLLAB_VERIFY_DIR",
      "DOC_COLLAB_MAX_SESSIONS",
    ]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);

test("验证入口默认关闭，并拒绝生产环境启用", async () => {
  const before = process.env.DOC_COLLAB_VERIFY_ENABLED;
  const config = loadConfig({
    ...process.env,
    APP_ENV: "development",
    HOST: "127.0.0.1",
    DATABASE_URL: "postgresql://localhost/unused_test",
  });
  const app = Fastify();
  try {
    process.env.DOC_COLLAB_VERIFY_ENABLED = "false";
    await registerDocumentVerification(app, config);
    expect(
      (await app.inject({ url: "/api/experimental/documents/test" }))
        .statusCode,
    ).toBe(404);
    process.env.DOC_COLLAB_VERIFY_ENABLED = "true";
    await expect(
      registerDocumentVerification(app, { ...config, APP_ENV: "production" }),
    ).rejects.toThrow("只允许");
  } finally {
    await app.close();
    if (before === undefined) delete process.env.DOC_COLLAB_VERIFY_ENABLED;
    else process.env.DOC_COLLAB_VERIFY_ENABLED = before;
  }
});
