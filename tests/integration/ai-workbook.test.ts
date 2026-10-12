import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/app_server/src/app";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import { hashPassword } from "../../system/server/src/modules/auth/password";
import { appUsers } from "../../apps/app_server/src/database/schema/users";
import { spaces } from "../../apps/app_server/src/database/schema/spaces";
import { files } from "../../apps/app_server/src/database/schema/files";
import {
  fileContents,
  fileVersions,
} from "../../apps/app_server/src/database/schema/contents";

const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw Error("AI工作簿测试仅使用独立_test库");
(url ? describe : describe.skip)("HTTP与官方MCP工作簿权威命令", () => {
  const db = createDatabase(url ?? "postgresql://localhost/unused_test");
  let app: Awaited<ReturnType<typeof buildApp>>,
    userId: string,
    loginToken: string,
    key: string,
    readKey: string,
    spaceId: string,
    fileId: string;
  let keyId: string;
  let replayBody: Record<string, unknown>,
    replayResponse: string,
    structuralReplayBody: Record<string, unknown>,
    structuralReplayResponse: string;
  const spaceIds: string[] = [],
    fileIds: string[] = [];
  const headers = (secret: string) => ({ authorization: `Bearer ${secret}` });
  const endpoint = () => `/api/v1/files/${fileId}/workbook`;
  const read = (query = "", secret = key) =>
    app.inject({ url: endpoint() + query, headers: headers(secret) });
  const patch = (body: Record<string, unknown>, secret = key) =>
    app.inject({
      method: "PATCH",
      url: endpoint(),
      headers: headers(secret),
      payload: body,
    });
  const mcp = (name: string, args: Record<string, unknown>, secret = key) =>
    app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        ...headers(secret),
        host: new URL(process.env.APP_PUBLIC_ORIGIN ?? "http://127.0.0.1:9811")
          .host,
        accept: "application/json, text/event-stream",
      },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      },
    });
  beforeAll(async () => {
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
    const [user] = await db.db
      .insert(appUsers)
      .values({
        account: `aiworkbook_${Date.now()}`,
        passwordHash: await hashPassword("AiWorkbookTest-2026!"),
      })
      .returning();
    userId = user!.id;
    const login = await app.inject({
      method: "POST",
      url: "/api/app/auth/login",
      payload: { account: user!.account, password: "AiWorkbookTest-2026!" },
    });
    expect(login.statusCode).toBe(200);
    loginToken = login.json().token;
    const space = await app.inject({
      method: "POST",
      url: "/api/app/spaces",
      headers: headers(loginToken),
      payload: { name: "AI表格测试空间" },
    });
    expect(space.statusCode).toBe(200);
    spaceId = space.json().id;
    spaceIds.push(spaceId);
    for (const permissions of [["read", "edit"], ["read"]]) {
      const issued = await app.inject({
        method: "POST",
        url: `/api/app/spaces/${spaceId}/api-keys`,
        headers: headers(loginToken),
        payload: { name: "Workbook API", permissions },
      });
      expect(issued.statusCode).toBe(200);
      if (permissions.includes("edit")) {
        key = issued.json().secret;
        keyId = issued.json().key.id;
      } else readKey = issued.json().secret;
    }
    const file = await app.inject({
      method: "POST",
      url: `/api/app/spaces/${spaceId}/files`,
      headers: headers(loginToken),
      payload: { name: "工作簿", kind: "sheet" },
    });
    expect(file.statusCode).toBe(200);
    fileId = file.json().id;
    fileIds.push(fileId);
  });
  afterAll(async () => {
    await app?.close();
    if (fileIds.length)
      await db.db.delete(files).where(inArray(files.id, fileIds));
    if (spaceIds.length)
      await db.db.delete(spaces).where(inArray(spaces.id, spaceIds));
    if (userId) await db.db.delete(appUsers).where(eq(appUsers.id, userId));
    await db.close();
  });
  test("值/公式/格式分离、保留格式、HTTP/MCP同请求幂等与清空", async () => {
    const initial = await read();
    expect(initial.statusCode).toBe(200);
    const book = initial.json<{
      revision: number;
      epoch: number;
      sheets: { sheetId: string }[];
    }>();
    const sheetId = book.sheets[0]!.sheetId;
    const body = {
      requestId: "workbook-set-0001",
      expectedRevision: book.revision,
      expectedEpoch: book.epoch,
      operations: [
        {
          type: "set_cells",
          sheetId,
          startRow: 0,
          startColumn: 0,
          cells: [
            [
              { value: 6, format: { fc: "#123456", bl: 1 } },
              { formula: "=A1*3" },
            ],
          ],
        },
      ],
    };
    expect((await patch(body, readKey)).statusCode).toBe(403);
    const written = await patch(body);
    if (written.statusCode !== 200)
      throw Error(`工作簿写入失败: ${written.body}`);
    expect(written.statusCode).toBe(200);
    replayBody = body;
    replayResponse = written.body;
    const reply = written.json<{
      revision: number;
      epoch: number;
      versionId: string;
    }>();
    expect(reply.versionId).toBeString();
    expect(reply.revision).toBe(book.revision + 1);
    expect((await patch(body)).body).toBe(written.body);
    const viaMcp = await mcp("update_workbook", { fileId, ...body });
    expect(viaMcp.statusCode).toBe(200);
    if (!viaMcp.json().result.structuredContent)
      throw Error(`MCP工作簿写入失败: ${viaMcp.body}`);
    expect(viaMcp.json().result.structuredContent.result.revision).toBe(
      reply.revision,
    );
    expect(
      (
        await patch({
          ...body,
          operations: [{ type: "delete_sheet", sheetId }],
        })
      ).statusCode,
    ).toBe(409);
    const result = await read(
      `?sheetId=${sheetId}&startRow=0&endRow=0&startColumn=0&endColumn=1&includeFormat=true`,
    );
    expect(result.statusCode).toBe(200);
    const cells = result.json().range.cells;
    expect(cells[0].value).toBe(6);
    expect(cells[0].formula).toBeNull();
    expect(cells[0].format.fc).toBe("#123456");
    expect(cells[1].formula).toBe("=A1*3");
    expect(cells[1].value).toBe(18);
    const changed = await patch({
      requestId: "workbook-set-0002",
      expectedRevision: reply.revision,
      expectedEpoch: reply.epoch,
      operations: [
        {
          type: "set_cells",
          sheetId,
          startRow: 0,
          startColumn: 0,
          cells: [[{ value: 8 }]],
        },
      ],
    });
    expect(changed.statusCode).toBe(200);
    const after = await read(
      `?sheetId=${sheetId}&startRow=0&endRow=0&startColumn=0&endColumn=1&includeFormat=true`,
    );
    expect(after.json().range.cells[0].format.fc).toBe("#123456");
    expect(after.json().range.cells[1].value).toBe(24);
    const cleared = await patch({
      requestId: "workbook-clear-0003",
      expectedRevision: changed.json().revision,
      expectedEpoch: reply.epoch,
      operations: [
        {
          type: "clear_range",
          sheetId,
          startRow: 0,
          endRow: 0,
          startColumn: 0,
          endColumn: 0,
        },
      ],
    });
    expect(cleared.statusCode).toBe(200);
    const empty = await read(
      `?sheetId=${sheetId}&startRow=0&endRow=0&startColumn=0&endColumn=0&includeFormat=true`,
    );
    expect(empty.json().range.cells[0].value).toBeNull();
    expect(empty.json().range.cells[0].format.fc).toBe("#123456");
  });
  test("结构与跨表公式经过引擎，失败整批回滚，MCP范围读与实时授权", async () => {
    const initial = (await read()).json();
    const sheetId = initial.sheets[0].sheetId;
    const update = {
      requestId: "workbook-structure-0004",
      expectedRevision: initial.revision,
      expectedEpoch: initial.epoch,
      operations: [
        {
          type: "add_sheet",
          sheetId: "ai-second",
          name: "Second",
          rows: 5,
          columns: 5,
        },
        {
          type: "set_cells",
          sheetId,
          startRow: 1,
          startColumn: 0,
          cells: [[{ value: 10 }]],
        },
        {
          type: "set_cells",
          sheetId: "ai-second",
          startRow: 0,
          startColumn: 0,
          cells: [[{ formula: `='工作表1'!A2+2` }]],
        },
        { type: "insert_rows", sheetId, index: 0, count: 1 },
      ],
    };
    const written = await patch(update);
    expect(written.statusCode).toBe(200);
    structuralReplayBody = update;
    structuralReplayResponse = written.body;
    const response = await mcp("read_workbook", {
      fileId,
      sheetId: "ai-second",
      startRow: 0,
      endRow: 0,
      startColumn: 0,
      endColumn: 0,
    });
    expect(response.statusCode).toBe(200);
    const snapshot = response.json().result.structuredContent.result;
    expect(snapshot.range.cells[0].value).toBe(12);
    expect(snapshot.range.cells[0].formula).toBe("='工作表1'!A3+2");
    const [before] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    const invalid = await patch({
      requestId: "workbook-invalid-0005",
      expectedRevision: snapshot.revision,
      expectedEpoch: snapshot.epoch,
      operations: [
        {
          type: "set_cells",
          sheetId,
          startRow: 2,
          startColumn: 0,
          cells: [[{ value: 99 }]],
        },
        { type: "delete_rows", sheetId: "missing", start: 0, end: 0 },
      ],
    });
    expect(invalid.statusCode).toBe(400);
    expect(
      (
        await db.db
          .select()
          .from(fileContents)
          .where(eq(fileContents.fileId, fileId))
      )[0]!.engineState,
    ).toEqual(before!.engineState);
    const stale = await patch({ ...update, requestId: "stale-request-0006" });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: "CONTENT_CONFLICT",
      currentRevision: snapshot.revision,
      currentEpoch: snapshot.epoch,
    });
    expect(
      (
        await read(
          `?sheetId=${sheetId}&startRow=0&endRow=9999&startColumn=0&endColumn=999`,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await patch({
          requestId: "ambiguous-value-0007",
          expectedRevision: snapshot.revision,
          expectedEpoch: snapshot.epoch,
          operations: [
            {
              type: "set_cells",
              sheetId,
              startRow: 0,
              startColumn: 0,
              cells: [[{ value: 3, formula: "=1+1" }]],
            },
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/app/api-keys/${keyId}`,
          headers: headers(loginToken),
          payload: { name: "Workbook API", permissions: ["read"] },
        })
      ).statusCode,
    ).toBe(200);
    const denied = await mcp("update_workbook", { fileId, ...update });
    expect(denied.json().result.isError).toBe(true);
    expect(denied.body).toContain("AI_PERMISSION_DENIED");
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/app/api-keys/${keyId}`,
          headers: headers(loginToken),
          payload: { name: "Workbook API", permissions: ["edit"] },
        })
      ).statusCode,
    ).toBe(200);
    expect((await read()).statusCode).toBe(403);
  });
  test("应用重启和房间幂等窗口压缩后，AI持久账本仍返回原结果而不重复结构命令", async () => {
    const [before] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    await app.close();
    await db.db
      .update(fileContents)
      .set({ engineState: { ...before!.engineState, roomAICommands: [] } })
      .where(eq(fileContents.fileId, fileId));
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
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/app/api-keys/${keyId}`,
          headers: headers(loginToken),
          payload: { name: "Workbook API", permissions: ["read", "edit"] },
        })
      ).statusCode,
    ).toBe(200);
    const repeated = await patch(replayBody);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.body).toBe(replayResponse);
    const structuralRepeated = await patch(structuralReplayBody);
    expect(structuralRepeated.statusCode).toBe(200);
    expect(structuralRepeated.body).toBe(structuralReplayResponse);
    expect(
      (
        await patch({
          ...replayBody,
          operations: [
            {
              type: "insert_rows",
              sheetId: (replayBody.operations as { sheetId: string }[])[0]!
                .sheetId,
              index: 0,
              count: 1,
            },
          ],
        })
      ).statusCode,
    ).toBe(409);
    const [after] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    expect(after!.revision).toBe(before!.revision);
    expect(after!.projection).toEqual(before!.projection);
  });
  test("真实HTTP表格导入UTF-8超限413及非法维度400，当前内容和历史原子保持", async () => {
    const [before] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    const history = await db.db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.fileId, fileId));
    const submit = (sheet: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: `/api/app/files/${fileId}/content-import`,
        headers: headers(loginToken),
        payload: {
          expectedRevision: before!.revision,
          expectedEpoch: before!.epoch,
          projection: { sheets: [sheet] },
        },
      });
    const malformed = await submit({
      id: "limit",
      name: "无效维度",
      row: 10001,
      column: 1,
      celldata: [],
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().code).toBe("INVALID_OPERATION");
    const oversized = await submit({
      id: "limit",
      name: "超限中文",
      row: 1,
      column: 1,
      celldata: [{ r: 0, c: 0, v: { v: "中".repeat(2_800_000) } }],
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().code).toBe("CONTENT_TOO_LARGE");
    const [after] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    expect(after!.revision).toBe(before!.revision);
    expect(after!.epoch).toBe(before!.epoch);
    expect(after!.projection).toEqual(before!.projection);
    expect(after!.engineState).toEqual(before!.engineState);
    expect(
      await db.db
        .select()
        .from(fileVersions)
        .where(eq(fileVersions.fileId, fileId)),
    ).toHaveLength(history.length);
  });
  test("正式HTTP会话退出即时撤销真实表格连接和旧协作凭证", async () => {
    const address = new URL(await app.listen({ port: 0, host: "127.0.0.1" }));
    const issue = () =>
      app.inject({
        method: "POST",
        url: `/api/app/files/${fileId}/collaboration-ticket`,
        headers: headers(loginToken),
        payload: { schemaVersion: 1, editSessionId: randomUUID() },
      });
    const authorized = await issue(),
      unused = await issue();
    expect(authorized.statusCode).toBe(200);
    expect(unused.statusCode).toBe(200);
    const packets: Record<string, unknown>[] = [];
    let closed = 0;
    const socket = new WebSocket(
      `ws://${address.host}/api/app/collaboration/sheets/${fileId}`,
    );
    socket.on("error", () => {});
    socket.on("message", (raw) =>
      packets.push(JSON.parse(raw.toString()) as Record<string, unknown>),
    );
    socket.on("close", (code) => {
      closed = code;
    });
    socket.on("open", () =>
      socket.send(
        JSON.stringify({
          type: "auth",
          ticket: authorized.json().ticket,
          protocolVersion: 1,
          schemaVersion: 1,
        }),
      ),
    );
    const wait = async (predicate: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!predicate()) {
        if (Date.now() > deadline) throw Error("正式HTTP表格授权验收等待超时");
        await Bun.sleep(5);
      }
    };
    try {
      await wait(() => packets.some((packet) => packet.type === "snapshot"));
      const logout = await app.inject({
        method: "POST",
        url: "/api/app/auth/logout",
        headers: headers(loginToken),
        payload: {},
      });
      expect(logout.statusCode).toBe(200);
      await wait(() => !!closed);
      expect(closed).toBe(4003);
      expect((await issue()).statusCode).toBe(401);
      const oldSocket = new WebSocket(
        `ws://${address.host}/api/app/collaboration/sheets/${fileId}`,
      );
      let oldClosed = 0;
      oldSocket.on("error", () => {});
      oldSocket.on("close", (code) => {
        oldClosed = code;
      });
      oldSocket.on("open", () =>
        oldSocket.send(
          JSON.stringify({
            type: "auth",
            ticket: unused.json().ticket,
            protocolVersion: 1,
            schemaVersion: 1,
          }),
        ),
      );
      try {
        await wait(() => !!oldClosed);
        expect(oldClosed).toBe(4003);
      } finally {
        oldSocket.terminate();
      }
    } finally {
      socket.terminate();
    }
  });
});
