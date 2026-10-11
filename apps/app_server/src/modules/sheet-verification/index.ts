import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { z } from "zod";
import type { AppConfig } from "@mas/system-server";
import { sheetCollaborationConfig } from "../../../../../config/sheet-collaboration";
import { SheetRoom } from "./room";
const messageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("initialize"), data: z.unknown() }),
  z.object({
    type: z.literal("op"),
    sequence: z.number().int().min(1),
    base: z.number().int().min(0),
    ops: z.unknown(),
  }),
  z.object({
    type: z.literal("presence"),
    sheetId: z.string().max(100),
    r: z.number().int().min(0).max(10000),
    c: z.number().int().min(0).max(1000),
  }),
]);
export async function registerSheetVerification(
  app: FastifyInstance,
  config: AppConfig,
) {
  const settings = sheetCollaborationConfig();
  if (settings.SHEET_COLLAB_VERIFY_ENABLED !== "true") return;
  if (config.APP_ENV !== "development" || config.HOST !== "127.0.0.1")
    throw Error("表格协作验证只允许 development 和 127.0.0.1");
  const rooms = new Map<string, Promise<SheetRoom>>();
  await app.register(websocket, {
    options: { maxPayload: 8 * 1024 * 1024 },
    preClose: async () => {
      // 停止接收输入后等待已提交写入落盘，避免关闭时丢失已接受的操作。
      for (const client of app.websocketServer.clients) client.terminate();
      await Promise.allSettled(
        [...rooms.values()].map(async (ready) => {
          const room = await ready;
          await room.run(async () => {});
        }),
      );
      await new Promise<void>((resolve, reject) => {
        app.websocketServer.close((error) =>
          error ? reject(error) : resolve(),
        );
      });
    },
  });
  app.get<{ Params: { id: string } }>(
    "/api/experimental/sheets/:id",
    {
      websocket: true,
      config: { auth: false },
      schema: {
        response: {
          200: { type: "object", additionalProperties: false, properties: {} },
        },
        tags: ["开发协作验证"],
        summary: "表格协作开发验证",
        description:
          "仅本机开发；演示身份，不提供正式空间授权。每个 WebSocket 占一个编辑名额。",
        params: {
          type: "object",
          properties: {
            id: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,80}$" },
          },
          required: ["id"],
        },
      },
    },
    (socket, request) => {
      const origin = request.headers.origin;
      if (origin) {
        try {
          const url = new URL(origin);
          if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
            socket.close(4003, "禁止访问");
            return;
          }
        } catch {
          socket.close(4003, "禁止访问");
          return;
        }
      }
      const id = request.params.id,
        sender = crypto.randomUUID();
      let room: SheetRoom | undefined;
      let alive = true;
      socket.on("close", () => {
        alive = false;
        room?.leave(sender);
      });
      socket.on("error", () => {});
      const queue: Buffer[] = [];
      let ready = false;
      const handle = (raw: Buffer) => {
        if (!room || !alive) return;
        const current = room;
        void current.run(async () => {
          try {
            const msg = messageSchema.parse(JSON.parse(raw.toString()));
            if (msg.type === "initialize") {
              await current.initialize(msg.data);
              socket.send(JSON.stringify({ ...current.snapshot(), sender }));
              current.broadcast({
                type: "members",
                count: current.members.size,
                limit: current.limit,
              });
            } else if (msg.type === "op") {
              if (!current.data.length) throw Error("表格未初始化");
              await current.submit(sender, msg.sequence, msg.base, msg.ops);
            } else
              current.broadcast({
                type: "presence",
                presence: {
                  userId: sender,
                  username: `编辑者 ${sender.slice(0, 4)}`,
                  color: "#198876",
                  sheetId: msg.sheetId,
                  selection: { r: msg.r, c: msg.c },
                },
              });
          } catch {
            socket.send(
              JSON.stringify({
                type: "error",
                message: "修改提交失败，已保留本地副本，请重新连接",
              }),
            );
          }
        });
      };
      socket.on("message", (raw: Buffer) => {
        const buffer = Buffer.from(raw as Buffer);
        if (ready) handle(buffer);
        else if (queue.length < 5) queue.push(buffer);
        else socket.close(4009, "请求过多");
      });
      if (!rooms.has(id))
        rooms.set(
          id,
          (async () => {
            const value = new SheetRoom(
              id,
              settings.SHEET_COLLAB_VERIFY_DIR,
              settings.SHEET_COLLAB_MAX_SESSIONS,
            );
            await value.load();
            return value;
          })(),
        );
      void rooms
        .get(id)!
        .then((value) => {
          if (!alive) return;
          room = value;
          const send = (message: unknown) => {
            if (socket.readyState === 1) socket.send(JSON.stringify(message));
          };
          if (!value.admit(sender, send)) {
            send({
              type: "full",
              limit: value.limit,
              message: `当前表格已达到 ${value.limit} 个编辑会话上限`,
            });
            socket.close(4008, "编辑人数已满");
            return;
          }
          ready = true;
          send({ type: "joined", sender });
          queue.forEach(handle);
        })
        .catch(() => socket.close(1011, "表格读取失败"));
    },
  );
}
