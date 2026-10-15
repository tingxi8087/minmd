import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Fastify from "fastify";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "../system/server/src/database/client";
import { loadConfig } from "../system/server/src/config/env";
import { hashToken } from "../system/server/src/modules/auth/password";
import {
  appUsers,
  appUserSessions,
} from "../apps/app_server/src/database/schema/users";
import {
  spaces,
  spaceMembers,
} from "../apps/app_server/src/database/schema/spaces";
import { files } from "../apps/app_server/src/database/schema/files";
import { fileContents } from "../apps/app_server/src/database/schema/contents";
import { registerSheetRooms } from "../apps/app_server/src/modules/collaboration/sheet-room";
import type { SheetRooms } from "../apps/app_server/src/modules/collaboration/sheet-room";
type Packet = Record<string, unknown>;
interface Client {
  socket: WebSocket;
  packets: Packet[];
  editSessionId: string;
  closed: number;
}
const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw new Error("表格协议测试只能使用独立 _test 数据库");
async function wait(check: () => boolean, label: string) {
  const deadline = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > deadline) throw Error(`等待超时：${label}`);
    await Bun.sleep(5);
  }
}
(url ? describe : describe.skip)(
  "真实表格协作协议、重连、重启及10会话上限",
  () => {
    const database = createDatabase(
      url ?? "postgresql://localhost/unused_test",
    );
    const config = loadConfig({
      DATABASE_URL: url ?? "postgresql://localhost/unused_test",
      APP_ENV: "staging",
      AUTH_TRANSPORT: "bearer",
      LOG_LEVEL: "silent",
    });
    const prefix = `sheetprotocol_${Date.now()}`;
    let app: ReturnType<typeof Fastify>, manager: SheetRooms, port: number;
    let userId: string,
      memberId: string,
      spaceId: string,
      fileId: string,
      otherFile: string,
      sessionId: string,
      memberSession: string;
    let a: Client, b: Client;
    const clients: Client[] = [];
    const latest = (client: Client) =>
      [...client.packets]
        .reverse()
        .find((packet) => packet.type === "snapshot")!;
    const cell = (client: Client, r: number, c: number) =>
      (
        latest(client).workbook as {
          data: (Record<string, unknown> | null)[][];
        }[]
      )[0].data[r][c];
    const start = async () => {
      app = Fastify({ logger: false, forceCloseConnections: true });
      manager = await registerSheetRooms(app, database, config);
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      if (!address || typeof address === "string") throw Error("监听失败");
      port = address.port;
    };
    const connect = async (
      member = false,
      editSessionId?: string,
      supplied?: string,
      target = fileId,
      protocolVersion = 1,
    ) => {
      const ticket = supplied
        ? { ticket: supplied, editSessionId: editSessionId ?? randomUUID() }
        : await manager.issueTicket(
            member ? memberId : userId,
            member ? memberSession : sessionId,
            target,
            1,
            editSessionId,
          );
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/api/app/collaboration/sheets/${target}`,
      );
      const client: Client = {
        socket,
        packets: [],
        editSessionId: ticket.editSessionId,
        closed: 0,
      };
      clients.push(client);
      socket.on("message", (raw) =>
        client.packets.push(JSON.parse(raw.toString()) as Packet),
      );
      socket.on("error", () => {});
      socket.on("close", (code) => (client.closed = code));
      await wait(
        () => socket.readyState === WebSocket.OPEN || !!client.closed,
        "WebSocket打开",
      );
      if (!client.closed)
        socket.send(
          JSON.stringify({
            type: "auth",
            ticket: ticket.ticket,
            schemaVersion: 1,
            protocolVersion,
          }),
        );
      await wait(
        () =>
          client.packets.some((packet) => packet.type === "snapshot") ||
          !!client.closed,
        "协作认证",
      );
      return client;
    };
    const send = async (client: Client, packet: Packet) => {
      const before = client.packets.length;
      client.socket.send(JSON.stringify(packet));
      await wait(
        () =>
          client.packets
            .slice(before)
            .some(
              (entry) =>
                entry.type === "ack" &&
                entry.operationId === packet.operationId,
            ) ||
          !!client.closed ||
          client.packets.slice(before).some((entry) => entry.type === "error"),
        "操作确认",
      );
    };
    beforeAll(async () => {
      const users = await database.db
        .insert(appUsers)
        .values(
          ["owner", "member"].map((name) => ({
            account: `${prefix}_${name}`,
            passwordHash: "fixture-no-login",
          })),
        )
        .returning({ id: appUsers.id });
      userId = users[0]!.id;
      memberId = users[1]!.id;
      const sessions = await database.db
        .insert(appUserSessions)
        .values(
          [userId, memberId].map((id) => ({
            userId: id,
            tokenHash: hashToken(randomUUID()),
            transport: "bearer",
            expiresAt: new Date(Date.now() + 120_000),
          })),
        )
        .returning({ id: appUserSessions.id });
      sessionId = sessions[0]!.id;
      memberSession = sessions[1]!.id;
      const [space] = await database.db
        .insert(spaces)
        .values({ name: prefix, ownerId: userId })
        .returning({ id: spaces.id });
      spaceId = space!.id;
      await database.db
        .insert(spaceMembers)
        .values([userId, memberId].map((id) => ({ userId: id, spaceId })));
      const created = await database.db
        .insert(files)
        .values(
          ["A", "B"].map((name) => ({
            name,
            kind: "sheet",
            spaceId,
            createdBy: userId,
            memberPermission: "edit" as const,
          })),
        )
        .returning({ id: files.id });
      fileId = created[0]!.id;
      otherFile = created[1]!.id;
      await database.db.insert(fileContents).values(
        [fileId, otherFile].map((id) => ({
          fileId: id,
          engine: "fortune",
          projection: {
            sheets: [
              {
                id: "s",
                name: "One",
                row: 5,
                column: 4,
                celldata: [
                  { r: 0, c: 0, v: { v: 2 } },
                  { r: 0, c: 1, v: { f: "=A1*3" } },
                ],
              },
            ],
          },
          revision: 1,
          projectionRevision: 1,
          epoch: 1,
        })),
      );
      await start();
      a = await connect();
      b = await connect(true);
    });
    afterAll(async () => {
      for (const client of clients) client.socket.terminate();
      await app?.close();
      if (fileId)
        await database.db
          .delete(files)
          .where(inArray(files.id, [fileId, otherFile]));
      if (spaceId)
        await database.db.delete(spaces).where(eq(spaces.id, spaceId));
      if (userId)
        await database.db
          .delete(appUsers)
          .where(inArray(appUsers.id, [userId, memberId]));
      await database.close();
    });
    test("真实WebSocket拒绝不兼容协议且不发布正文或占用编辑名额", async () => {
      const invalid = await connect(false, undefined, undefined, fileId, 2);
      expect(invalid.closed).toBe(4003);
      expect(invalid.packets.some((packet) => packet.type === "snapshot")).toBe(
        false,
      );
      const valid = await connect();
      expect(valid.closed).toBe(0);
      expect(latest(valid).type).toBe("snapshot");
      valid.socket.close();
      await wait(() => !!valid.closed, "释放兼容验证连接");
    });
    test("协作选区显示服务端昵称，空昵称回退账号且不接受客户端伪造名称", async () => {
      await database.db
        .update(appUsers)
        .set({ nickname: "协作昵称" })
        .where(eq(appUsers.id, userId));
      const named = await connect();
      named.socket.send(
        JSON.stringify({
          type: "presence",
          username: "伪造名称",
          selection: { sheetId: "s", row: 0, column: 0 },
        }),
      );
      await wait(
        () =>
          b.packets.some(
            (packet) =>
              packet.type === "presence" &&
              packet.editSessionId === named.editSessionId,
          ),
        "昵称选区",
      );
      expect(
        b.packets.find(
          (packet) =>
            packet.type === "presence" &&
            packet.editSessionId === named.editSessionId,
        )?.displayName,
      ).toBe("协作昵称");
      b.socket.send(
        JSON.stringify({
          type: "presence",
          selection: { sheetId: "s", row: 0, column: 1 },
        }),
      );
      await wait(
        () =>
          named.packets.some(
            (packet) =>
              packet.type === "presence" &&
              packet.editSessionId === b.editSessionId,
          ),
        "账号选区",
      );
      expect(
        named.packets.find(
          (packet) =>
            packet.type === "presence" &&
            packet.editSessionId === b.editSessionId,
        )?.displayName,
      ).toBe(`${prefix}_member`);
      named.socket.close();
      await wait(() => !!named.closed, "关闭昵称测试会话");
    });
    test("两个账号同格并发收敛，个人撤销不覆盖他人输入", async () => {
      const base = Number(latest(a).revision);
      await Promise.all([
        send(a, {
          type: "operations",
          operationId: "a-cell",
          epoch: 1,
          baseRevision: base,
          operations: [
            { type: "setCell", sheetId: "s", row: 1, column: 0, value: "A" },
          ],
        }),
        send(b, {
          type: "operations",
          operationId: "b-cell",
          epoch: 1,
          baseRevision: base,
          operations: [
            { type: "setCell", sheetId: "s", row: 1, column: 0, value: "B" },
          ],
        }),
      ]);
      await wait(() => latest(a).revision === latest(b).revision, "双端收敛");
      expect(cell(a, 1, 0)).toEqual(cell(b, 1, 0));
      await send(a, {
        type: "undo",
        baseRevision: 1,
        operationId: "undo-cell",
        epoch: 1,
      });
      expect(cell(a, 1, 0)?.v).toBe("B");
      const revision = latest(a).revision;
      await send(a, {
        type: "undo",
        baseRevision: 1,
        operationId: "undo-cell",
        epoch: 1,
      });
      expect(latest(a).revision).toBe(revision);
    });
    test("缺失基准修订的旧撤销包明确拒绝，不重复撤销或发布保存确认", async () => {
      const before = Number(latest(a).revision);
      const start = a.packets.length;
      await send(a, {
        type: "undo",
        operationId: "legacy-undo-without-base",
        epoch: 1,
      });
      const packets = a.packets.slice(start);
      expect(
        packets.some(
          (packet) =>
            packet.type === "error" && packet.code === "MESSAGE_INVALID",
        ),
      ).toBe(true);
      expect(packets.some((packet) => packet.type === "ack")).toBe(false);
      expect(latest(a).revision).toBe(before);
    });
    test("并发插行与旧坐标公式写入都正确，服务端计算结果广播", async () => {
      const base = Number(latest(a).revision);
      await Promise.all([
        send(a, {
          type: "operations",
          operationId: "insert",
          epoch: 1,
          baseRevision: base,
          operations: [
            { type: "insertRows", sheetId: "s", index: 0, count: 1 },
          ],
        }),
        send(b, {
          type: "operations",
          operationId: "formula",
          epoch: 1,
          baseRevision: base,
          operations: [
            {
              type: "setCell",
              sheetId: "s",
              row: 2,
              column: 0,
              value: { f: "=A1*5" },
            },
          ],
        }),
      ]);
      await wait(
        () => latest(a).revision === latest(b).revision,
        "结构公式同步",
      );
      expect(cell(a, 1, 1)?.f).toBe("=A2*3");
      expect(cell(a, 1, 1)?.v).toBe(6);
      expect(cell(a, 3, 0)?.f).toBe("=A2*5");
      expect(cell(b, 3, 0)?.v).toBe(10);
    });
    test("断线同标签重连保留个人撤销来源与幂等操作", async () => {
      const identity = a.editSessionId;
      a.socket.close();
      await wait(() => !!a.closed, "断开");
      a = await connect(false, identity);
      await send(a, {
        type: "undo",
        baseRevision: 1,
        operationId: "undo-structure",
        epoch: 1,
      });
      expect(cell(a, 0, 1)?.f).toBe("=A1*3");
      expect(cell(a, 2, 0)?.v).toBe(10);
    });
    test("10个标签计10会话，第11个拒绝，释放后可重新加入，凭证限文件单次", async () => {
      const extras: Client[] = [];
      for (let i = 0; i < 8; i++) extras.push(await connect());
      await wait(
        () =>
          a.packets.some(
            (packet) => packet.type === "members" && packet.count === 10,
          ),
        "10会话在线状态",
      );
      const memberPacket = a.packets
        .filter((packet) => packet.type === "members")
        .at(-1)!;
      expect(memberPacket.count).toBe(10);
      expect(
        (memberPacket.members as { userId: string }[]).filter(
          (entry) => entry.userId === userId,
        ).length,
      ).toBe(9);
      const full = await connect();
      expect(full.closed).toBe(4008);
      extras[0].socket.close();
      await wait(() => !!extras[0].closed, "释放名额");
      const replacement = await connect();
      expect(replacement.closed).toBe(0);
      for (const client of [...extras.slice(1), replacement])
        client.socket.close();
      await wait(
        () =>
          [...extras.slice(1), replacement].every((entry) => !!entry.closed),
        "清理额外连接",
      );
      const ticket = await manager.issueTicket(userId, sessionId, fileId);
      const wrong = await connect(
        false,
        ticket.editSessionId,
        ticket.ticket,
        otherFile,
      );
      expect(wrong.closed).toBe(4003);
      const used = await manager.issueTicket(userId, sessionId, fileId);
      const valid = await connect(false, used.editSessionId, used.ticket);
      expect(valid.closed).toBe(0);
      const replay = await connect(false, used.editSessionId, used.ticket);
      expect(replay.closed).toBe(4003);
      valid.socket.close();
      await wait(() => !!valid.closed, "关闭验证连接");
    });
    test("到达时突发频率及超大JSON帧被拒绝，排队慢事务不会稀释限流", async () => {
      const before = Number(latest(a).revision);
      const burst = await connect();
      for (let index = 0; index < 110; index++)
        burst.socket.send(JSON.stringify({ type: "ping" }));
      await wait(() => !!burst.closed, "突发发送限流关闭");
      expect(burst.closed).toBe(4007);
      const large = await connect();
      large.socket.send(
        JSON.stringify({
          type: "operations",
          operationId: "oversized",
          epoch: 1,
          baseRevision: before,
          operations: [],
          padding: "x".repeat(8 * 1024 * 1024),
        }),
      );
      await wait(() => !!large.closed, "超大消息关闭");
      expect([4006, 1009]).toContain(large.closed);
      const [content] = await database.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId));
      expect(content!.revision).toBe(before);
      expect(large.packets.some((packet) => packet.type === "ack")).toBe(false);
    });
    test("真实连接主动撤销登录、账号及文件授权，并使未使用凭证失效", async () => {
      const sameSource = a.editSessionId;
      const unused = await manager.issueTicket(userId, sessionId, fileId);
      manager.revokeSession(sessionId);
      await wait(() => !!a.closed, "主动撤销登录连接");
      expect(a.closed).toBe(4003);
      const invalid = await connect(false, unused.editSessionId, unused.ticket);
      expect(invalid.closed).toBe(4003);
      a = await connect(false, sameSource);
      const other = await connect(true);
      await database.db
        .update(appUsers)
        .set({ status: "disabled" })
        .where(eq(appUsers.id, memberId));
      manager.revokeUser(memberId, spaceId);
      await wait(
        () => !!other.closed && !!b.closed,
        "停用账号主动断开所有编辑标签",
      );
      expect(other.closed).toBe(4003);
      expect(b.closed).toBe(4003);
      await expect(
        manager.issueTicket(memberId, memberSession, fileId),
      ).rejects.toThrow();
      await database.db
        .update(appUsers)
        .set({ status: "enabled" })
        .where(eq(appUsers.id, memberId));
      b = await connect(true);
      const folderTicket = await manager.issueTicket(
        userId,
        sessionId,
        otherFile,
      );
      const deleted = await connect(
        false,
        folderTicket.editSessionId,
        folderTicket.ticket,
        otherFile,
      );
      await database.db
        .update(files)
        .set({ deletedAt: new Date() })
        .where(eq(files.id, otherFile));
      manager.revokeFiles([otherFile]);
      await wait(() => !!deleted.closed, "文件软删除主动撤销连接");
      expect(deleted.closed).toBe(4003);
      await expect(
        manager.issueTicket(userId, sessionId, otherFile),
      ).rejects.toThrow();
      await database.db
        .update(files)
        .set({ deletedAt: null })
        .where(eq(files.id, otherFile));
    });
    test("编辑权限降为只读后，下一次写入拒绝并关闭连接", async () => {
      await database.db
        .update(files)
        .set({ memberPermission: "read" })
        .where(eq(files.id, fileId));
      try {
        await send(b, {
          type: "operations",
          operationId: "read-only-forbidden",
          epoch: 1,
          baseRevision: Number(latest(b).revision),
          operations: [
            {
              type: "setCell",
              sheetId: "s",
              row: 0,
              column: 0,
              value: "read-only-forbidden",
            },
          ],
        });
        await wait(() => !!b.closed, "只读权限关闭编辑连接");
        expect(b.closed).toBe(4003);
        const [current] = await database.db
          .select()
          .from(fileContents)
          .where(eq(fileContents.fileId, fileId));
        expect(JSON.stringify(current!.projection)).not.toContain(
          "read-only-forbidden",
        );
      } finally {
        await database.db
          .update(files)
          .set({ memberPermission: "edit" })
          .where(eq(files.id, fileId));
      }
      b = await connect(true);
    });
    test("服务重启恢复当前状态与个人历史；被移除成员下一次写入立即关闭", async () => {
      const identity = a.editSessionId,
        before = latest(a).workbook;
      await app.close();
      await start();
      a = await connect(false, identity);
      expect(latest(a).workbook).toEqual(before);
      await send(a, {
        type: "redo",
        baseRevision: 1,
        operationId: "redo-after-restart",
        epoch: 1,
      });
      expect(cell(a, 1, 1)?.f).toBe("=A2*3");
      b = await connect(true);
      await database.db
        .delete(spaceMembers)
        .where(eq(spaceMembers.userId, memberId));
      await send(b, {
        type: "operations",
        operationId: "forbidden",
        epoch: 1,
        baseRevision: Number(latest(b).revision),
        operations: [
          {
            type: "setCell",
            sheetId: "s",
            row: 0,
            column: 0,
            value: "forbidden",
          },
        ],
      });
      await wait(() => !!b.closed, "成员撤销关闭连接");
      expect(b.closed).toBe(4003);
      const [current] = await database.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId));
      expect(JSON.stringify(current!.projection)).not.toContain("forbidden");
    });
    test("真实导入和历史恢复广播新epoch，旧连接、旧票据及重放消息均不能写入", async () => {
      const original = latest(a).workbook;
      const revision = Number(latest(a).revision);
      const editSessionId = a.editSessionId;
      const unused = await manager.issueTicket(userId, sessionId, fileId);
      const replaced = await manager.replaceWorkbook(fileId, userId, {
        expectedRevision: revision,
        expectedEpoch: 1,
        projection: {
          sheets: [
            {
              id: "imported",
              name: "导入",
              row: 2,
              column: 2,
              celldata: [{ r: 0, c: 0, v: { v: "新版本" } }],
            },
          ],
        },
        source: "import",
      });
      expect(replaced.epoch).toBe(2);
      await wait(() => !!a.closed, "导入撤销旧连接");
      expect(a.closed).toBe(4009);
      expect(
        a.packets.some(
          (packet) => packet.type === "epoch" && packet.epoch === 2,
        ),
      ).toBe(true);
      const staleTicket = await connect(
        false,
        unused.editSessionId,
        unused.ticket,
      );
      expect(staleTicket.closed).toBe(4003);
      a = await connect(false, editSessionId);
      expect(latest(a).epoch).toBe(2);
      await send(a, {
        type: "operations",
        operationId: "old-epoch-retry",
        epoch: 1,
        baseRevision: revision,
        operations: [
          { type: "setCell", sheetId: "s", row: 0, column: 0, value: "旧改动" },
        ],
      });
      await wait(() => !!a.closed, "旧epoch消息拒绝");
      expect(a.closed).toBe(4009);
      const [current] = await database.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId));
      expect(current!.revision).toBe(replaced.revision);
      expect(JSON.stringify(current!.projection)).not.toContain("旧改动");
      a = await connect(false, editSessionId);
      const restored = await manager.replaceWorkbook(fileId, userId, {
        expectedRevision: replaced.revision,
        expectedEpoch: 2,
        projection: { sheets: original },
        source: "restore",
      });
      expect(restored.epoch).toBe(3);
      await wait(() => !!a.closed, "恢复撤销导入连接");
      expect(a.closed).toBe(4009);
      a = await connect(false, editSessionId);
      expect(latest(a).epoch).toBe(3);
      expect(latest(a).workbook).toEqual(original);
    });
  },
);
