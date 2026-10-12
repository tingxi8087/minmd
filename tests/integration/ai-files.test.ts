import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { eq, like, inArray } from "drizzle-orm";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  fileContents,
  fileVersions,
} from "../../apps/app_server/src/database/schema/contents";
import JSZip from "jszip";
import Fastify from "fastify";
import { AiService } from "../../apps/app_server/src/modules/ai/service";
import { registerMcp } from "../../apps/app_server/src/modules/mcp";
import { DocumentRooms } from "../../apps/app_server/src/modules/collaboration/document-room";
import { SheetRooms } from "../../apps/app_server/src/modules/collaboration/sheet-room";
import { AppError } from "../../system/server/src/errors";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import { hashPassword } from "../../system/server/src/modules/auth/password";
const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw Error("AI文件测试只使用独立_test库");
(url ? describe : describe.skip)("AI文件目录和附件权限及持久幂等", () => {
  const db = createDatabase(url ?? "postgresql://localhost/unused_test"),
    prefix = `aifile_${Date.now()}`;
  let app: Awaited<ReturnType<typeof buildApp>>,
    login: string,
    spaceId: string,
    key: string,
    readKey: string,
    directory: string,
    folderId: string,
    docId: string,
    secondarySpaceId: string;
  const previousDir = process.env.ASSET_STORAGE_DIR,
    previousOrigin = process.env.APP_PUBLIC_ORIGIN;
  const origin = "http://127.0.0.1:5173",
    host = "127.0.0.1:5173";
  const h = (credential = key) => ({
    authorization: `Bearer ${credential}`,
    host,
  });
  const send = (
    method: "POST" | "PATCH" | "GET" | "PUT",
    path: string,
    payload?: Record<string, unknown>,
    credential = key,
  ) =>
    app.inject({
      method,
      url: path,
      headers: h(credential),
      ...(payload ? { payload } : {}),
    });
  const mcp = (
    body: Record<string, unknown>,
    extra: Record<string, string> = {},
  ) =>
    app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        ...h(),
        accept: "application/json, text/event-stream",
        ...extra,
      },
      payload: body,
    });
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "minmd-ai-files-test-"));
    process.env.ASSET_STORAGE_DIR = directory;
    process.env.APP_PUBLIC_ORIGIN = origin;
    const [user] = await db.db
      .insert(appUsers)
      .values({
        account: prefix,
        passwordHash: await hashPassword("Ai-file-test-123!"),
      })
      .returning();
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
    login = (
      await app.inject({
        method: "POST",
        url: "/api/app/auth/login",
        payload: { account: user!.account, password: "Ai-file-test-123!" },
      })
    ).json().token;
    const space = await send(
      "POST",
      "/api/app/spaces",
      { name: prefix },
      login,
    );
    expect(space.statusCode).toBe(200);
    spaceId = space.json().id;
    key = (
      await send(
        "POST",
        `/api/app/spaces/${spaceId}/api-keys`,
        {
          name: "完整文件授权",
          permissions: [
            "read",
            "edit",
            "create",
            "organize",
            "delete_restore",
            "upload",
          ],
        },
        login,
      )
    ).json().secret;
    readKey = (
      await send(
        "POST",
        `/api/app/spaces/${spaceId}/api-keys`,
        { name: "只读", permissions: ["read"] },
        login,
      )
    ).json().secret;
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
    if (secondarySpaceId) {
      await db.db.delete(files).where(eq(files.spaceId, secondarySpaceId));
      await db.db.delete(spaces).where(eq(spaces.id, secondarySpaceId));
    }
    await db.db.delete(appUsers).where(like(appUsers.account, `${prefix}%`));
    await db.close();
    if (previousDir === undefined) delete process.env.ASSET_STORAGE_DIR;
    else process.env.ASSET_STORAGE_DIR = previousDir;
    if (previousOrigin === undefined) delete process.env.APP_PUBLIC_ORIGIN;
    else process.env.APP_PUBLIC_ORIGIN = previousOrigin;
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  test("显式API密钥与create授权，初始化内容且并发幂等", async () => {
    const input = {
      requestId: `${prefix}_folder`,
      kind: "folder",
      name: "AI目录",
    };
    expect((await send("POST", "/api/v1/files", input, login)).statusCode).toBe(
      401,
    );
    expect(
      (await send("POST", "/api/v1/files", input, readKey)).statusCode,
    ).toBe(403);
    const [a, b] = await Promise.all([
      send("POST", "/api/v1/files", input),
      send("POST", "/api/v1/files", input),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    folderId = a.json().id;
    expect(a.json().visibility).toBe("private");
    expect(
      (await send("POST", "/api/v1/files", { ...input, name: "另一个请求" }))
        .statusCode,
    ).toBe(409);
    const doc = await send("POST", "/api/v1/files", {
      requestId: `${prefix}_doc`,
      kind: "doc",
      name: "AI正文",
      parentId: folderId,
    });
    expect(doc.statusCode).toBe(200);
    docId = doc.json().id;
    expect(
      (
        await app.inject({
          url: `/api/app/files/${docId}/content`,
          headers: h(login),
        })
      ).statusCode,
    ).toBe(200);
  });
  test("organize修订/循环校验与delete_restore同批次重放", async () => {
    const rename = {
      requestId: `${prefix}_rename`,
      name: "AI改名",
      expectedMetadataRevision: 1,
    };
    expect(
      (await send("PATCH", `/api/v1/files/${docId}`, rename, readKey))
        .statusCode,
    ).toBe(403);
    const renamed = await send("PATCH", `/api/v1/files/${docId}`, rename);
    expect(renamed.statusCode).toBe(200);
    expect(
      (await send("PATCH", `/api/v1/files/${docId}`, rename)).json(),
    ).toEqual(renamed.json());
    expect(
      (
        await send("PATCH", `/api/v1/files/${docId}`, {
          ...rename,
          requestId: `${prefix}_stale`,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await send("POST", `/api/v1/files/${folderId}/move`, {
          requestId: `${prefix}_cycle`,
          parentId: docId,
          expectedMetadataRevision: 1,
        })
      ).statusCode,
    ).toBe(409);
    const remove = {
      requestId: `${prefix}_delete`,
      expectedMetadataRevision: 1,
    };
    const deleted = await send(
      "POST",
      `/api/v1/files/${folderId}/delete`,
      remove,
    );
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().deletedIds).toContain(docId);
    expect(
      (await send("POST", `/api/v1/files/${folderId}/delete`, remove)).json(),
    ).toEqual(deleted.json());
    expect(
      (
        await app.inject({
          url: `/api/app/files/${docId}/content`,
          headers: h(login),
        })
      ).statusCode,
    ).toBe(409);
    const meta = await send("GET", `/api/v1/files/${folderId}`);
    expect(meta.statusCode).toBe(200);
    const restored = await send("POST", `/api/v1/files/${folderId}/restore`, {
      requestId: `${prefix}_restore`,
      expectedMetadataRevision: meta.json().metadataRevision,
      parentId: null,
    });
    expect(restored.statusCode).toBe(200);
    expect(
      (await send("GET", `/api/v1/files/${docId}`)).json().deletedAt,
    ).toBeNull();
  });
  test("HTTP附件实际检测、同请求上传重放不留重复磁盘文件", async () => {
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    );
    const multipart = Buffer.concat([
      Buffer.from(
        '--minmd\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n',
      ),
      bytes,
      Buffer.from("\r\n--minmd--\r\n"),
    ]);
    const upload = (credential = key) =>
      app.inject({
        method: "POST",
        url: "/api/v1/assets",
        headers: {
          ...h(credential),
          "x-request-id": `${prefix}_upload`,
          "content-type": "multipart/form-data; boundary=minmd",
        },
        payload: multipart,
      });
    expect((await upload(readKey)).statusCode).toBe(403);
    const first = await upload();
    expect(first.statusCode).toBe(200);
    expect((await upload()).json()).toEqual(first.json());
    expect(
      (await db.db.select().from(assets).where(eq(assets.spaceId, spaceId)))
        .length,
    ).toBe(1);
    expect((await readdir(directory)).length).toBe(1);
  });
  test("AI按修订绑定替换PPTX并保留历史，重复请求不覆盖后续版本", async () => {
    const slide = await send("POST", "/api/v1/files", {
      kind: "slide",
      name: "AI幻灯片",
      requestId: `${prefix}_slide`,
    });
    expect(slide.statusCode).toBe(200);
    const fileId = slide.json().id;
    const mime =
      "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    const uploadPpt = async (
      count: number,
      credential = key,
      expectedStatus = 200,
    ) => {
      const zip = new JSZip();
      zip.file(
        "[Content_Types].xml",
        '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
      );
      zip.file("_rels/.rels", "<Relationships/>");
      zip.file("ppt/presentation.xml", '<p:presentation xmlns:p="test"/>');
      for (let index = 1; index <= count; index++)
        zip.file(`ppt/slides/slide${index}.xml`, "<p:sld/>");
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/assets",
        headers: {
          ...h(credential),
          "x-request-id": `${prefix}_ppt_${count}`,
          "content-type": "multipart/form-data; boundary=ppt",
        },
        payload: Buffer.concat([
          Buffer.from(
            `--ppt\r\nContent-Disposition: form-data; name="file"; filename="deck${count}.pptx"\r\nContent-Type: ${mime}\r\n\r\n`,
          ),
          await zip.generateAsync({ type: "nodebuffer" }),
          Buffer.from("\r\n--ppt--\r\n"),
        ]),
      });
      expect(response.statusCode).toBe(expectedStatus);
      return response.json().id as string;
    };
    const firstAsset = await uploadPpt(1);
    const path = `/api/v1/files/${fileId}/presentation`;
    const initial = {
      assetId: firstAsset,
      expectedRevision: 1,
      expectedEpoch: 1,
      requestId: `${prefix}_bind_1`,
    };
    expect((await send("PUT", path, initial, readKey)).statusCode).toBe(403);
    const editKeyResponse = await send(
      "POST",
      `/api/app/spaces/${spaceId}/api-keys`,
      { name: "仅内容编辑", permissions: ["edit"] },
      login,
    );
    expect(editKeyResponse.statusCode).toBe(200);
    const editKey = editKeyResponse.json().secret as string;
    await uploadPpt(3, editKey, 403);
    const first = await send("PUT", path, initial, editKey);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      revision: 2,
      epoch: 2,
      projection: { slides: 1, assetId: firstAsset },
    });
    const secondAsset = await uploadPpt(2);
    const second = await send("PUT", path, {
      assetId: secondAsset,
      expectedRevision: 2,
      expectedEpoch: 2,
      requestId: `${prefix}_bind_2`,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      revision: 3,
      epoch: 3,
      projection: { slides: 2, assetId: secondAsset },
    });
    expect((await send("PUT", path, initial, editKey)).json()).toEqual(
      first.json(),
    );
    const stale = await send("PUT", path, {
      ...initial,
      requestId: `${prefix}_bind_stale`,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ currentRevision: 3, currentEpoch: 3 });
    const history = await db.db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.fileId, fileId));
    expect(history.length).toBe(3);
    expect(history.map((version) => version.projection.assetId)).toContain(
      firstAsset,
    );
    expect(history.map((version) => version.projection.assetId)).toContain(
      secondAsset,
    );
    const preserved = await db.db
      .select()
      .from(versionAssets)
      .where(
        inArray(
          versionAssets.versionId,
          history.map((version) => version.id),
        ),
      );
    expect(preserved.map((reference) => reference.assetId).sort()).toEqual(
      [firstAsset, secondAsset].sort(),
    );
    expect(
      (
        await db.db
          .select()
          .from(fileAssets)
          .where(eq(fileAssets.fileId, fileId))
      ).map((reference) => reference.assetId),
    ).toEqual([secondAsset]);
    const [missing] = await db.db
      .insert(assets)
      .values({
        spaceId,
        uploadedBy: slide.json().createdBy,
        storageKey: crypto.randomUUID(),
        filename: "missing.pptx",
        mime,
        size: 100,
        checksum: "0".repeat(64),
      })
      .returning();
    const failed = await send("PUT", path, {
      assetId: missing!.id,
      expectedRevision: 3,
      expectedEpoch: 3,
      requestId: `${prefix}_bind_missing`,
    });
    expect(failed.statusCode).toBe(404);
    const foreignSpace = await send(
      "POST",
      "/api/app/spaces",
      { name: `${prefix}_ppt_foreign` },
      login,
    );
    expect(foreignSpace.statusCode).toBe(200);
    try {
      await db.db
        .update(assets)
        .set({ spaceId: foreignSpace.json().id })
        .where(eq(assets.id, missing!.id));
      const foreign = await send("PUT", path, {
        assetId: missing!.id,
        expectedRevision: 3,
        expectedEpoch: 3,
        requestId: `${prefix}_bind_foreign`,
      });
      expect(foreign.statusCode).toBe(403);
    } finally {
      await db.db.delete(assets).where(eq(assets.id, missing!.id));
      await db.db.delete(spaces).where(eq(spaces.id, foreignSpace.json().id));
    }
    const [current] = await db.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    expect(current).toMatchObject({
      revision: 3,
      epoch: 3,
      projection: { assetId: secondAsset },
    });
  });
  test("MCP文件工具共用权限/幂等，Host与方法边界", async () => {
    for (const method of ["GET", "DELETE"] as const) {
      const response = await app.inject({ method, url: "/mcp" });
      expect(response.statusCode).toBe(405);
      expect(response.headers.allow).toBe("POST");
    }
    const payload = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    expect((await mcp(payload, { host: "attacker.invalid" })).statusCode).toBe(
      403,
    );
    const list = await mcp(payload);
    expect(list.statusCode).toBe(200);
    expect(
      list.json().result.tools.map((tool: { name: string }) => tool.name),
    ).toContain("create_file");
    const call = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "create_file",
        arguments: {
          requestId: `${prefix}_mcp`,
          kind: "folder",
          name: "MCP目录",
        },
      },
    };
    const first = await mcp(call),
      replay = await mcp({ ...call, id: 3 });
    expect(first.statusCode).toBe(200);
    expect(first.json().result.structuredContent.result.id).toBe(
      replay.json().result.structuredContent.result.id,
    );
    const denied = await mcp(
      {
        ...call,
        id: 4,
        params: {
          ...call.params,
          arguments: { ...call.params.arguments, requestId: `${prefix}_deny` },
        },
      },
      { authorization: `Bearer ${readKey}` },
    );
    expect(denied.json().result.isError).toBe(true);
    expect(denied.json().result.content[0].text).toContain(
      "AI_PERMISSION_DENIED",
    );
  });
  test("真实SDK搜索按字面匹配通配符并限制密钥空间", async () => {
    const name = "literal_%\\文件";
    const local = await send("POST", "/api/v1/files", {
      name,
      kind: "doc",
      requestId: `${prefix}_search`,
    });
    expect(local.statusCode).toBe(200);
    expect(
      (
        await send("POST", "/api/v1/files", {
          name: "literalXX文件",
          kind: "doc",
          requestId: `${prefix}_search_decoy`,
        })
      ).statusCode,
    ).toBe(200);
    const foreign = await send(
      "POST",
      "/api/app/spaces",
      { name: "搜索隔离空间" },
      login,
    );
    const foreignId = foreign.json().id as string;
    try {
      expect(
        (
          await send(
            "POST",
            `/api/app/spaces/${foreignId}/files`,
            { name, kind: "doc" },
            login,
          )
        ).statusCode,
      ).toBe(200);
      const response = await mcp({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "list_files",
          arguments: { search: "_%\\", pageSize: 100 },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().result.isError).not.toBe(true);
      const result = response.json().result.structuredContent.result;
      expect(result.total).toBe(1);
      expect(result.items.map((file: { id: string }) => file.id)).toEqual([
        local.json().id,
      ]);
      expect(result.items[0].spaceId).toBe(spaceId);
    } finally {
      await db.db.delete(files).where(eq(files.spaceId, foreignId));
      await db.db.delete(spaces).where(eq(spaces.id, foreignId));
    }
  });
  test("真实HTTP MCP发现返回完整文件工具契约", async () => {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const response = await fetch(`${address}/mcp`, {
      method: "POST",
      headers: {
        ...h(),
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      result: { tools: { name: string }[] };
    };
    expect(data.result.tools.map((tool) => tool.name)).toContain(
      "upload_asset",
    );
    expect(data.result.tools.map((tool) => tool.name)).toContain(
      "restore_file",
    );
    for (let i = 0; i < 6; i++) {
      const response = await fetch(`${address}/mcp`, {
        method: "POST",
        headers: {
          ...h(),
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify(
          i % 2
            ? {
                jsonrpc: "2.0",
                id: 100 + i,
                method: "tools/call",
                params: {
                  name: "read_file_metadata",
                  arguments: { fileId: docId },
                },
              }
            : { jsonrpc: "2.0", id: 100 + i, method: "tools/list" },
        ),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        result: {
          structuredContent?: { result: { id: string } };
          tools?: unknown[];
        };
      };
      if (i % 2) expect(body.result.structuredContent!.result.id).toBe(docId);
      else expect(body.result.tools!.length).toBeGreaterThan(5);
    }
  });
  test("真实大文档读取限额支持按块读取，官方MCP传输严格限制输出", async () => {
    const created = await send("POST", "/api/v1/files", {
      kind: "doc",
      name: "大文档输出验收",
      requestId: `${prefix}_large`,
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().id as string;
    const imported = await send(
      "POST",
      `/api/app/files/${id}/content-import`,
      {
        expectedRevision: 1,
        expectedEpoch: 1,
        projection: {
          type: "doc",
          content: [0, 1].map(() => ({
            type: "paragraph",
            content: [{ type: "text", text: "x".repeat(300 * 1024) }],
          })),
        },
      },
      login,
    );
    expect(imported.statusCode).toBe(200);
    const oversized = await send("GET", `/api/v1/files/${id}/document`);
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().code).toBe("AI_RESPONSE_TOO_LARGE");
    const stored = await send(
      "GET",
      `/api/app/files/${id}/content`,
      undefined,
      login,
    );
    const blockId = stored.json().projection.content[0].attrs.blockId;
    const selected = await send(
      "GET",
      `/api/v1/files/${id}/document?blockIds=${blockId}`,
    );
    expect(selected.statusCode).toBe(200);
    expect(selected.json().projection.content).toHaveLength(1);
    const tooLargeMcp = await mcp({
      jsonrpc: "2.0",
      id: 91,
      method: "tools/call",
      params: { name: "read_document", arguments: { fileId: id } },
    });
    expect(tooLargeMcp.statusCode).toBe(200);
    expect(tooLargeMcp.body).toContain("AI_RESPONSE_TOO_LARGE");
    const config = loadConfig({
      DATABASE_URL: url!,
      APP_ENV: "staging",
      AUTH_TRANSPORT: "bearer",
      LOG_LEVEL: "silent",
    });
    const documents = new DocumentRooms(db, config),
      sheets = new SheetRooms(db, config);
    const limited = Fastify({ logger: false });
    limited.setErrorHandler((error, request, reply) =>
      reply.code(error instanceof AppError ? error.statusCode : 500).send({
        code: error instanceof AppError ? error.code : "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "未知错误",
        requestId: request.id,
      }),
    );
    await registerMcp(
      limited,
      db,
      config,
      new AiService(db, documents, sheets, directory),
      1024,
    );
    try {
      const discovery = await limited.inject({
        method: "POST",
        url: "/mcp",
        headers: { ...h(), accept: "application/json, text/event-stream" },
        payload: { jsonrpc: "2.0", id: 92, method: "tools/list" },
      });
      expect(discovery.statusCode).toBe(413);
      expect(discovery.json().code).toBe("AI_RESPONSE_TOO_LARGE");
      const ordinary = await mcp({
        jsonrpc: "2.0",
        id: 93,
        method: "tools/list",
      });
      expect(ordinary.statusCode).toBe(200);
      expect(Buffer.byteLength(ordinary.body)).toBeGreaterThan(1024);
      expect(Buffer.byteLength(ordinary.body)).toBeLessThan(2 * 1024 * 1024);
    } finally {
      await limited.close();
      await documents.close();
      await sheets.close();
    }
  });
  test("真实SDK工具每次重验密钥创建者状态与撤销，不缓存初次授权", async () => {
    const issued = await send(
      "POST",
      `/api/app/spaces/${spaceId}/api-keys`,
      { name: "撤销SDK授权验收", permissions: ["read"] },
      login,
    );
    expect(issued.statusCode).toBe(200);
    const secret = issued.json().secret as string;
    const [file] = await db.db.select().from(files).where(eq(files.id, docId));
    const invoke = () =>
      app.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          ...h(secret),
          accept: "application/json, text/event-stream",
        },
        payload: {
          jsonrpc: "2.0",
          id: 101,
          method: "tools/call",
          params: { name: "read_file_metadata", arguments: { fileId: docId } },
        },
      });
    expect((await invoke()).statusCode).toBe(200);
    try {
      await db.db
        .update(appUsers)
        .set({ status: "disabled" })
        .where(eq(appUsers.id, file!.createdBy));
      expect((await invoke()).statusCode).toBe(403);
    } finally {
      await db.db
        .update(appUsers)
        .set({ status: "enabled" })
        .where(eq(appUsers.id, file!.createdBy));
    }
    expect((await invoke()).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/app/api-keys/${issued.json().key.id}`,
          headers: h(login),
        })
      ).statusCode,
    ).toBe(200);
    expect((await invoke()).statusCode).toBe(401);
  });
  test("同账号另一空间也不可写，密钥缩权实时拒绝后续调用", async () => {
    const space = await send(
      "POST",
      "/api/app/spaces",
      { name: `${prefix}_secondary` },
      login,
    );
    expect(space.statusCode).toBe(200);
    secondarySpaceId = space.json().id;
    const folder = await send(
      "POST",
      `/api/app/spaces/${secondarySpaceId}/files`,
      { kind: "folder", name: "另一空间" },
      login,
    );
    const id = folder.json().id as string;
    expect(
      (
        await send("POST", "/api/v1/files", {
          kind: "doc",
          name: "跨空间创建",
          parentId: id,
          requestId: `${prefix}_foreigncreate`,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await send("PATCH", `/api/v1/files/${id}`, {
          name: "跨空间改名",
          expectedMetadataRevision: 1,
          requestId: `${prefix}_foreignrename`,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await send("POST", `/api/v1/files/${id}/delete`, {
          expectedMetadataRevision: 1,
          requestId: `${prefix}_foreigndelete`,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await send("POST", `/api/v1/files/${docId}/purge`, { confirm: true }))
        .statusCode,
    ).toBe(404);
    const ownKeys = await app.inject({
      url: `/api/app/spaces/${spaceId}/api-keys`,
      headers: h(login),
    });
    const originalKey = ownKeys
      .json<{ items: { id: string; prefix: string }[] }>()
      .items.find((item) => key.startsWith(item.prefix))!;
    const policy = await app.inject({
      method: "PATCH",
      url: `/api/app/api-keys/${originalKey.id}`,
      headers: h(login),
      payload: { name: "缩权助手", permissions: ["read"] },
    });
    expect(policy.statusCode).toBe(200);
    expect(
      (
        await send("POST", "/api/v1/files", {
          kind: "folder",
          name: "旧密钥已缩权",
          requestId: `${prefix}_oldpolicy`,
        })
      ).statusCode,
    ).toBe(403);
    expect((await send("GET", `/api/v1/files/${docId}`)).statusCode).toBe(200);
  });
});
