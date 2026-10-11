import WebSocket from "ws";
import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { loadConfig } from "../system/server/src/config/env";
import {
  SheetRoom,
  applyOperations,
  type Operation,
} from "../apps/app_server/src/modules/sheet-verification/room";
import { registerSheetVerification } from "../apps/app_server/src/modules/sheet-verification";
import { sheetCollaborationConfig } from "../config/sheet-collaboration";
const seed = [
  {
    id: "sheet",
    name: "测试",
    row: 4,
    column: 3,
    celldata: [
      { r: 0, c: 0, v: { v: 1 } },
      { r: 1, c: 1, v: { f: "=A1+1", v: 2 } },
    ],
  },
];
const cell = (r: number, c: number, v: number): Operation => ({
  op: "replace",
  id: "sheet",
  path: ["data", r, c],
  value: { v },
});
test("协作配置默认 10，会话上限严格校验", () => {
  expect(sheetCollaborationConfig({}).SHEET_COLLAB_MAX_SESSIONS).toBe(10);
  for (const value of ["0", "101", "1.5", "bad"])
    expect(() =>
      sheetCollaborationConfig({ SHEET_COLLAB_MAX_SESSIONS: value }),
    ).toThrow();
});
test("并发单元格操作、重复请求、结构冲突及持久化恢复", async () => {
  const dir = await mkdtemp(join(tmpdir(), "minmd-sheet-test-"));
  try {
    const room = new SheetRoom("test", dir, 10);
    await room.load();
    await room.initialize(seed);
    const packets: unknown[] = [];
    room.admit("a", (p) => packets.push(p));
    room.admit("b", (p) => packets.push(p));
    await Promise.all([
      room.run(() => room.submit("a", 1, 0, [cell(0, 0, 7)])),
      room.run(() => room.submit("b", 1, 0, [cell(0, 1, 8)])),
    ]);
    expect(room.revision).toBe(2);
    expect((room.data[0].data as unknown[][])[0][0]).toEqual({ v: 7 });
    expect((room.data[0].data as unknown[][])[0][1]).toEqual({ v: 8 });
    await room.submit("a", 1, 0, [cell(0, 0, 100)]);
    expect(room.revision).toBe(2);
    await room.submit("a", 2, 2, [
      { op: "replace", id: "sheet", path: ["row"], value: 5 },
      {
        op: "insertRowCol",
        id: "sheet",
        path: [],
        value: { type: "row", index: 0, count: 1, direction: "lefttop" },
      },
      {
        op: "replace",
        id: "sheet",
        path: ["data", 2, 1],
        value: { f: "=A2+1", v: 8 },
      },
    ]);
    expect((room.data[0].data as unknown[][]).length).toBe(5);
    expect(room.revision).toBe(3);
    await room.submit("b", 2, 2, [cell(0, 0, 99)]);
    expect(room.revision).toBe(3);
    expect(
      packets.some((p) => (p as { typeConflict?: boolean }).typeConflict),
    ).toBe(true);
    const restored = new SheetRoom("test", dir, 10);
    await restored.load();
    expect(restored.data).toEqual(room.data);
    expect(restored.revision).toBe(3);
    expect(() =>
      applyOperations(room.data, [
        {
          op: "add",
          id: "sheet",
          path: ["__proto__", "polluted"],
          value: true,
        },
      ]),
    ).toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("真实 WebSocket 双端同步、房间隔离、第 11 个会话拒绝与名额释放", async () => {
  const dir = await mkdtemp(join(tmpdir(), "minmd-sheet-ws-test-"));
  const old = { ...process.env };
  process.env.SHEET_COLLAB_VERIFY_ENABLED = "true";
  process.env.SHEET_COLLAB_VERIFY_DIR = dir;
  process.env.SHEET_COLLAB_MAX_SESSIONS = "10";
  const app = Fastify({ logger: false, forceCloseConnections: true });
  const sockets: WebSocket[] = [];
  try {
    await registerSheetVerification(
      app,
      loadConfig({
        APP_ENV: "development",
        HOST: "127.0.0.1",
        DATABASE_URL: "postgresql://localhost/unused_test",
      }),
    );
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw Error("没有端口");
    const connect = async (room = "shared") => {
      const packets: Record<string, unknown>[] = [];
      const ws = new WebSocket(
        `ws://127.0.0.1:${address.port}/api/experimental/sheets/${room}`,
      );
      sockets.push(ws);
      ws.on("message", (raw) => packets.push(JSON.parse(String(raw))));
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", () => reject(Error("连接失败")));
      });
      ws.send(JSON.stringify({ type: "initialize", data: seed }));
      return { ws, packets };
    };
    const wait = async (condition: () => boolean) => {
      const deadline = Date.now() + 4000;
      while (!condition()) {
        if (Date.now() > deadline) throw Error("等待协作消息超时");
        await Bun.sleep(10);
      }
    };
    const a = await connect(),
      b = await connect(),
      other = await connect("isolated");
    await wait(() =>
      [a, b, other].every((c) => c.packets.some((p) => p.type === "snapshot")),
    );
    a.ws.send(
      JSON.stringify({
        type: "op",
        base: 0,
        sequence: 1,
        ops: [cell(0, 0, 42)],
      }),
    );
    await wait(() => b.packets.some((p) => p.type === "op"));
    expect(other.packets.some((p) => p.type === "op")).toBe(false);
    for (let i = 0; i < 8; i++) await connect();
    const full = await connect();
    await wait(() => full.packets.some((p) => p.type === "full"));
    expect(full.packets.find((p) => p.type === "full")?.limit).toBe(10);
    a.ws.close();
    await wait(() =>
      b.packets.some((p) => p.type === "members" && p.count === 9),
    );
    const replacement = await connect();
    await wait(() => replacement.packets.some((p) => p.type === "snapshot"));
    expect(replacement.packets.some((p) => p.type === "full")).toBe(false);
  } finally {
    await app.close();
    for (const ws of sockets) ws.terminate();
    for (const key of [
      "SHEET_COLLAB_VERIFY_ENABLED",
      "SHEET_COLLAB_VERIFY_DIR",
      "SHEET_COLLAB_MAX_SESSIONS",
    ]) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
