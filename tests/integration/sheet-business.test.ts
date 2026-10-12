import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import { hashToken } from "../../system/server/src/modules/auth/password";
import {
  appUsers,
  appUserSessions,
} from "../../apps/app_server/src/database/schema/users";
import {
  spaces,
  spaceMembers,
} from "../../apps/app_server/src/database/schema/spaces";
import { files } from "../../apps/app_server/src/database/schema/files";
import {
  fileContents,
  fileVersions,
} from "../../apps/app_server/src/database/schema/contents";
import { SheetRooms } from "../../apps/app_server/src/modules/collaboration/sheet-room";
import type { SheetAtomicMutation } from "../../apps/app_server/src/modules/collaboration/sheet-room";

const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw new Error("表格业务测试只能使用独立 _test 数据库");
(url ? describe : describe.skip)("表格业务权威存储、历史和权限", () => {
  const database = createDatabase(url ?? "postgresql://localhost/unused_test");
  const prefix = `sheetbusiness_${Date.now()}`;
  let manager: SheetRooms;
  let userId: string,
    outsider: string,
    sessionId: string,
    spaceId: string,
    fileId: string;
  let connection: string;
  const packets: Record<string, unknown>[] = [];
  const socket = {
    send: (value: string) =>
      packets.push(JSON.parse(value) as Record<string, unknown>),
    close: () => {},
  };
  const body = (text: string) => ({
    sheets: [
      {
        id: "s",
        name: "One",
        row: 3,
        column: 3,
        celldata: [{ r: 0, c: 0, v: { v: text } }],
      },
    ],
  });
  const read = async () =>
    (
      await database.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId))
    )[0]!;
  beforeAll(async () => {
    const users = await database.db
      .insert(appUsers)
      .values(
        ["owner", "outside"].map((name) => ({
          account: `${prefix}_${name}`,
          passwordHash: "fixture-no-login",
        })),
      )
      .returning({ id: appUsers.id });
    userId = users[0]!.id;
    outsider = users[1]!.id;
    const [session] = await database.db
      .insert(appUserSessions)
      .values({
        userId,
        tokenHash: hashToken(randomUUID()),
        transport: "bearer",
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning({ id: appUserSessions.id });
    sessionId = session!.id;
    const [space] = await database.db
      .insert(spaces)
      .values({ name: prefix, ownerId: userId })
      .returning({ id: spaces.id });
    spaceId = space!.id;
    await database.db.insert(spaceMembers).values({ userId, spaceId });
    const [file] = await database.db
      .insert(files)
      .values({ spaceId, createdBy: userId, name: "测试表格", kind: "sheet" })
      .returning({ id: files.id });
    fileId = file!.id;
    await database.db.insert(fileContents).values({
      fileId,
      engine: "fortune",
      projection: body("initial"),
      revision: 1,
      epoch: 1,
      projectionRevision: 1,
    });
    manager = new SheetRooms(
      database,
      loadConfig({
        DATABASE_URL: url!,
        APP_ENV: "staging",
        AUTH_TRANSPORT: "bearer",
        LOG_LEVEL: "silent",
      }),
    );
    const ticket = await manager.issueTicket(userId, sessionId, fileId);
    connection = manager.attach(fileId, socket);
    await manager.receive(connection, {
      type: "auth",
      ticket: ticket.ticket,
      protocolVersion: 1,
      schemaVersion: 1,
    });
    expect(packets.some((packet) => packet.type === "snapshot")).toBe(true);
  });
  afterAll(async () => {
    await manager?.close();
    if (fileId) await database.db.delete(files).where(eq(files.id, fileId));
    if (spaceId) await database.db.delete(spaces).where(eq(spaces.id, spaceId));
    if (userId)
      await database.db
        .delete(appUsers)
        .where(inArray(appUsers.id, [userId, outsider]));
    await database.close();
  });
  test("初始化只写一次稳定身份，外部账号不能签发凭证", async () => {
    const first = await read();
    expect(first.engineState).not.toBeNull();
    await manager.issueTicket(userId, sessionId, fileId);
    expect((await read()).engineState).toEqual(first.engineState);
    await expect(
      manager.issueTicket(outsider, sessionId, fileId),
    ).rejects.toThrow();
    await expect(
      manager.issueTicket(userId, sessionId, fileId, 2),
    ).rejects.toThrow();
  });
  test("事务提交后才确认，重复未变化手动保存不增加版本", async () => {
    await manager.receive(connection, {
      type: "operations",
      operationId: "write",
      epoch: 1,
      baseRevision: 1,
      operations: [
        { type: "setCell", sheetId: "s", row: 1, column: 0, value: "saved" },
      ],
    });
    const current = await read();
    expect(current.revision).toBe(2);
    expect(current.projectionRevision).toBe(2);
    expect(
      packets.some(
        (packet) =>
          packet.type === "ack" &&
          packet.operationId === "write" &&
          packet.revision === 2,
      ),
    ).toBe(true);
    const first = await manager.checkpoint(userId, fileId, { manual: true });
    const second = await manager.checkpoint(userId, fileId, { manual: true });
    expect(second.versionId).toBe(first.versionId);
  });
  test("真实数据库提交失败回滚，不发布候选或saved确认，重试成功", async () => {
    const transaction = database.db.transaction.bind(database.db);
    let failOnce = true;
    database.db.transaction = (callback, options) =>
      transaction(async (tx) => {
        const value = await callback(tx);
        if (failOnce) {
          failOnce = false;
          await tx.execute(sql`select 1 / 0`);
        }
        return value;
      }, options);
    const before = await read();
    const packet = {
      type: "operations",
      operationId: "failure-retry",
      epoch: 1,
      baseRevision: 2,
      operations: [
        { type: "setCell", sheetId: "s", row: 1, column: 1, value: "pending" },
      ],
    };
    try {
      await manager.receive(connection, packet);
      expect((await read()).revision).toBe(before.revision);
      expect((await read()).projection).toEqual(before.projection);
      expect(
        packets.some(
          (item) => item.type === "ack" && item.operationId === "failure-retry",
        ),
      ).toBe(false);
      expect(
        packets.some(
          (item) => item.type === "error" && item.code === "SAVE_FAILED",
        ),
      ).toBe(true);
      await manager.receive(connection, packet);
      expect((await read()).revision).toBe(3);
    } finally {
      database.db.transaction = transaction;
    }
  });
  test("历史是独立快照，替换失败保留当前，恢复切换epoch并拒绝旧包", async () => {
    const old = await manager.checkpoint(userId, fileId, { manual: true });
    const [version] = await database.db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.id, old.versionId!));
    await expect(
      manager.replaceWorkbook(fileId, userId, {
        expectedRevision: 1,
        expectedEpoch: 1,
        projection: body("wrong"),
        source: "import",
      }),
    ).rejects.toThrow();
    const replaced = await manager.replaceWorkbook(fileId, userId, {
      expectedRevision: 3,
      expectedEpoch: 1,
      projection: body("new"),
      source: "import",
    });
    expect(replaced.epoch).toBe(2);
    expect(replaced.revision).toBe(4);
    expect(
      (
        await database.db
          .select()
          .from(fileVersions)
          .where(eq(fileVersions.id, old.versionId!))
      )[0]!.projection,
    ).toEqual(version!.projection);
    expect(
      packets.some((packet) => packet.type === "epoch" && packet.epoch === 2),
    ).toBe(true);
    const restored = await manager.replaceWorkbook(fileId, userId, {
      expectedRevision: 4,
      expectedEpoch: 2,
      projection: version!.projection,
      source: "restore",
    });
    expect(restored.epoch).toBe(3);
    await manager.receive(connection, {
      type: "operations",
      operationId: "stale",
      epoch: 1,
      baseRevision: 3,
      operations: [
        { type: "setCell", sheetId: "s", row: 0, column: 0, value: "stale" },
      ],
    });
    expect((await read()).revision).toBe(5);
  });
  test("AI 原子批次、调用者同事务回调、实时广播及幂等结果", async () => {
    const ticket = await manager.issueTicket(userId, sessionId, fileId);
    const online = manager.attach(fileId, socket);
    await manager.receive(online, {
      type: "auth",
      ticket: ticket.ticket,
      schemaVersion: 1,
      protocolVersion: 1,
    });
    const before = await read();
    let authorized = 0,
      committed = 0;
    const input: SheetAtomicMutation = {
      fileId,
      userId,
      entityId: "test-api-key",
      requestId: "ai-atomic-batch",
      expectedRevision: before.revision,
      expectedEpoch: before.epoch,
      operations: [
        {
          type: "setCell" as const,
          sheetId: "s",
          row: 1,
          column: 0,
          value: { v: 7 },
        },
        {
          type: "setCell" as const,
          sheetId: "s",
          row: 1,
          column: 1,
          value: { f: "=A2*4" },
        },
      ],
      authorize: async () => {
        authorized++;
      },
      onCommitted: async () => {
        committed++;
      },
    };
    packets.length = 0;
    const saved = await manager.mutateWorkbookAtomic(input);
    const current = await read();
    expect(current.revision).toBe(before.revision + 1);
    expect(
      (current.projection.sheets as { data: { v?: unknown }[][] }[])[0]!
        .data[1]![1]!.v,
    ).toBe(28);
    expect(
      packets.some(
        (packet) =>
          packet.type === "snapshot" &&
          packet.source === "ai" &&
          packet.revision === saved.revision,
      ),
    ).toBe(true);
    expect(packets.some((packet) => packet.type === "ack")).toBe(false);
    expect(
      (
        await database.db
          .select()
          .from(fileVersions)
          .where(eq(fileVersions.id, saved.versionId!))
      )[0]!.source,
    ).toBe("ai");
    await manager.receive(online, {
      type: "operations",
      operationId: "human-after-ai",
      epoch: current.epoch,
      baseRevision: current.revision,
      operations: [
        { type: "setCell", sheetId: "s", row: 2, column: 0, value: 9 },
      ],
    });
    packets.length = 0;
    expect(await manager.mutateWorkbookAtomic(input)).toEqual(saved);
    expect(authorized).toBe(2);
    expect(committed).toBe(1);
    expect(packets).toHaveLength(0);
    await expect(
      manager.mutateWorkbookAtomic({
        ...input,
        operations: [
          { type: "setCell", sheetId: "s", row: 1, column: 0, value: 8 },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      manager.mutateWorkbookAtomic({
        ...input,
        requestId: "new-stale-request",
      }),
    ).rejects.toThrow();
    await expect(
      manager.mutateWorkbookAtomic({
        ...input,
        authorize: async () => {
          throw Error("revoked fixture grant");
        },
      }),
    ).rejects.toThrow();
    const previous = await read();
    packets.length = 0;
    await expect(
      manager.mutateWorkbookAtomic({
        ...input,
        requestId: "ai-failed-commit",
        expectedRevision: previous.revision,
        onCommitted: async (tx) => {
          await tx.execute(sql`select 1 / 0`);
        },
      }),
    ).rejects.toThrow();
    expect((await read()).engineState).toEqual(previous.engineState);
    expect((await read()).revision).toBe(previous.revision);
    expect(packets).toHaveLength(0);
    await expect(
      manager.mutateWorkbookAtomic({
        ...input,
        requestId: "ai-invalid-batch",
        expectedRevision: previous.revision,
        operations: [
          ...input.operations,
          { type: "setCell", sheetId: "missing", row: 0, column: 0, value: 1 },
        ],
      }),
    ).rejects.toThrow();
    expect((await read()).engineState).toEqual(previous.engineState);
    manager.detach(online);
  });
  test("超过五分钟的修改建立自动版本，新窗口修改不重复创建版本", async () => {
    const previous = await read();
    await database.db
      .update(fileVersions)
      .set({ createdAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(fileVersions.fileId, fileId));
    const ticket = await manager.issueTicket(userId, sessionId, fileId);
    const active = manager.attach(fileId, socket);
    await manager.receive(active, {
      type: "auth",
      ticket: ticket.ticket,
      protocolVersion: 1,
      schemaVersion: 1,
    });
    const before = await database.db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.fileId, fileId));
    const packet = {
      type: "operations",
      operationId: "automatic-version-write",
      epoch: previous.epoch,
      baseRevision: previous.revision,
      operations: [
        { type: "setCell", sheetId: "s", row: 1, column: 0, value: "自动版本" },
      ],
    };
    await manager.receive(active, packet);
    const history = await database.db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.fileId, fileId));
    expect(history).toHaveLength(before.length + 1);
    const automatic = history.find(
      (version) => version.revision === previous.revision + 1,
    )!;
    expect(automatic.source).toBe("auto");
    expect(automatic.projection).toEqual((await read()).projection);
    await manager.receive(active, {
      ...packet,
      operationId: "automatic-window-second",
      baseRevision: previous.revision + 1,
      operations: [
        {
          type: "setCell",
          sheetId: "s",
          row: 1,
          column: 0,
          value: "窗口内继续编辑",
        },
      ],
    });
    expect(
      await database.db
        .select()
        .from(fileVersions)
        .where(eq(fileVersions.fileId, fileId)),
    ).toHaveLength(history.length);
    manager.detach(active);
  });
  test("账号停用后，旧登录会话不可重新取得房间凭证", async () => {
    await database.db
      .update(appUsers)
      .set({ status: "disabled" })
      .where(eq(appUsers.id, userId));
    await expect(
      manager.issueTicket(userId, sessionId, fileId),
    ).rejects.toThrow();
    await database.db
      .update(appUsers)
      .set({ status: "enabled" })
      .where(eq(appUsers.id, userId));
    await database.db
      .update(appUserSessions)
      .set({ revokedAt: new Date() })
      .where(eq(appUserSessions.id, sessionId));
    await expect(
      manager.issueTicket(userId, sessionId, fileId),
    ).rejects.toThrow();
  });
});
