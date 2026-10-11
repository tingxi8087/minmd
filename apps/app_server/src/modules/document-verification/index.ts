import { Hocuspocus } from "@hocuspocus/server";
import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "@mas/system-server";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Y from "yjs";
import { documentCollaborationConfig } from "../../../../../config/document-collaboration";

type Context = { fileId: string };
export async function registerDocumentVerification(
  app: FastifyInstance,
  config: AppConfig,
) {
  const settings = documentCollaborationConfig();
  if (settings.DOC_COLLAB_VERIFY_ENABLED !== "true") return;
  if (config.APP_ENV !== "development" || config.HOST !== "127.0.0.1")
    throw Error("文档协作验证只允许 development 和 127.0.0.1");
  if (!app.hasDecorator("websocketServer"))
    await app.register(websocket, {
      options: { maxPayload: 8 * 1024 * 1024 },
      preClose: async () => {
        for (const client of app.websocketServer.clients) client.terminate();
        await new Promise<void>((resolve, reject) =>
          app.websocketServer.close((error) =>
            error ? reject(error) : resolve(),
          ),
        );
      },
    });
  const slots = new Map<string, Set<string>>();
  const initializer = new Map<string, string>();
  const writes = new Map<string, Promise<void>>();
  const persist = (id: string, state: Uint8Array) => {
    const task = (writes.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await mkdir(settings.DOC_COLLAB_VERIFY_DIR, { recursive: true });
        const path = join(settings.DOC_COLLAB_VERIFY_DIR, `${id}.yjs`);
        await writeFile(`${path}.tmp`, state);
        await rename(`${path}.tmp`, path);
      });
    writes.set(id, task);
    return task;
  };
  const server = new Hocuspocus<Context>({
    debounce: 100,
    maxDebounce: 500,
    quiet: true,
    async onAuthenticate({ documentName, context }) {
      if (documentName !== context.fileId) throw Error("文档房间不匹配");
      return context;
    },
    async onLoadDocument({ documentName, document }) {
      try {
        Y.applyUpdate(
          document,
          await readFile(
            join(settings.DOC_COLLAB_VERIFY_DIR, `${documentName}.yjs`),
          ),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw Error("文档协作状态读取失败");
      }
      return document;
    },
    async onStoreDocument({ documentName, document }) {
      try {
        const state = Y.encodeStateAsUpdate(document);
        const snapshot = Array.from(Y.encodeSnapshot(Y.snapshot(document)));
        await persist(documentName, state);
        document.broadcastStateless(
          JSON.stringify({ type: "saved", snapshot }),
        );
      } catch {
        document.broadcastStateless(
          JSON.stringify({
            type: "error",
            message: "服务器保存失败，请保留页面并下载备份",
          }),
        );
        throw Error("文档协作状态保存失败");
      }
    },
    async onStateless({ documentName, document, connection, payload }) {
      if (payload === "initialize") {
        if (document.getMap("minmd").get("initialized")) {
          connection.sendStateless(JSON.stringify({ type: "ready" }));
          const state = Y.encodeStateAsUpdate(document);
          const snapshot = Array.from(Y.encodeSnapshot(Y.snapshot(document)));
          await persist(documentName, state);
          connection.sendStateless(JSON.stringify({ type: "saved", snapshot }));
        } else if (
          !initializer.has(documentName) ||
          initializer.get(documentName) === connection.socketId
        ) {
          initializer.set(documentName, connection.socketId);
          connection.sendStateless(JSON.stringify({ type: "initialize" }));
        }
        connection.sendStateless(
          JSON.stringify({
            type: "members",
            count: slots.get(documentName)?.size ?? 0,
            limit: settings.DOC_COLLAB_MAX_SESSIONS,
          }),
        );
      } else if (
        payload === "initialized" &&
        initializer.get(documentName) === connection.socketId
      ) {
        document.getMap("minmd").set("initialized", true);
        initializer.delete(documentName);
        document.broadcastStateless(JSON.stringify({ type: "ready" }));
      }
    },
    async onDisconnect({ documentName, socketId }) {
      if (initializer.get(documentName) === socketId)
        initializer.delete(documentName);
    },
  });
  app.addHook("onClose", async () => {
    server.closeConnections();
    server.flushPendingStores();
    await Promise.allSettled(writes.values());
    for (const doc of server.documents.values())
      await persist(doc.name, Y.encodeStateAsUpdate(doc));
  });
  app.get<{ Params: { id: string } }>(
    "/api/experimental/documents/:id",
    {
      websocket: true,
      config: { auth: false },
      schema: {
        tags: ["开发协作验证"],
        summary: "文档协作开发验证",
        description:
          "仅本机开发；演示身份，每个连接占一个编辑会话。禁止正式空间使用。",
        params: {
          type: "object",
          properties: {
            id: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,80}$" },
          },
          required: ["id"],
        },
        response: {
          200: { type: "object", properties: {}, additionalProperties: false },
        },
      },
    },
    (socket, request) => {
      const origin = request.headers.origin;
      if (
        origin &&
        !["127.0.0.1", "localhost"].includes(URL.parse(origin)?.hostname ?? "")
      ) {
        socket.close(4003, "禁止访问");
        return;
      }
      const id = request.params.id;
      const sessions = slots.get(id) ?? new Set<string>();
      slots.set(id, sessions);
      if (sessions.size >= settings.DOC_COLLAB_MAX_SESSIONS) {
        socket.close(
          4008,
          `文档已达到 ${settings.DOC_COLLAB_MAX_SESSIONS} 个编辑会话上限`,
        );
        return;
      }
      const sessionId = crypto.randomUUID();
      sessions.add(sessionId);
      const members = () =>
        server.documents.get(id)?.broadcastStateless(
          JSON.stringify({
            type: "members",
            count: sessions.size,
            limit: settings.DOC_COLLAB_MAX_SESSIONS,
          }),
        );
      socket.once("close", () => {
        sessions.delete(sessionId);
        members();
      });
      socket.on("error", () => {});
      const connection = server.handleConnection(
        socket,
        new Request(`http://127.0.0.1${request.url}`, {
          headers: origin ? { origin } : {},
        }),
        { fileId: id },
      );
      socket.on("message", (raw, binary) => {
        if (!binary) {
          socket.close(4003, "协作协议格式无效");
          return;
        }
        const bytes = Array.isArray(raw)
          ? Buffer.concat(raw)
          : raw instanceof ArrayBuffer
            ? new Uint8Array(raw)
            : raw;
        connection.handleMessage(bytes);
      });
      socket.once("close", (code, reason) =>
        connection.handleClose({ code, reason: reason.toString() }),
      );
      members();
    },
  );
  return server;
}
