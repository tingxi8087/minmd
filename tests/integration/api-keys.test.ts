import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../../apps/app_server/src/app";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import {
  hashPassword,
  hashToken,
} from "../../system/server/src/modules/auth/password";
import { appUsers } from "../../apps/app_server/src/database/schema/users";
import {
  spaces,
  spaceMembers,
} from "../../apps/app_server/src/database/schema/spaces";
import { files } from "../../apps/app_server/src/database/schema/files";
import { apiKeys } from "../../apps/app_server/src/database/schema/ai";
import { authorizeAi } from "../../apps/app_server/src/modules/api-keys/service";
import Fastify from "fastify";
import { registerAiRateLimit } from "../../apps/app_server/src/modules/api-keys/rate-limit";
import { AppError } from "../../system/server/src/errors";

const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw Error("密钥测试只允许独立_test数据库");
(url ? describe : describe.skip)("空间独立密钥权限管理", () => {
  const db = createDatabase(url ?? "postgresql://localhost/unused_test");
  const users: string[] = [],
    spaceIds: string[] = [],
    fileIds: string[] = [];
  let app: Awaited<ReturnType<typeof buildApp>>,
    ownerToken: string,
    memberToken: string,
    spaceId: string;
  const header = (token = ownerToken) => ({ authorization: `Bearer ${token}` });
  const issue = (permissions?: string[], token = memberToken) =>
    app.inject({
      method: "POST",
      url: `/api/app/spaces/${spaceId}/api-keys`,
      headers: header(token),
      payload: { name: "AI验收", ...(permissions ? { permissions } : {}) },
    });
  beforeAll(async () => {
    app = await buildApp(
      loadConfig({
        DATABASE_URL: url,
        APP_ENV: "staging",
        AUTH_TRANSPORT: "bearer",
        LOG_LEVEL: "silent",
        WEB_CMS_DIST: "tests/fixtures/web-cms",
        WEB_DIST: "tests/fixtures/web",
      }),
      { logger: false },
    );
    for (const suffix of ["owner", "member", "other"]) {
      const [user] = await db.db
        .insert(appUsers)
        .values({
          account: `apikey_${Date.now()}_${suffix}`,
          passwordHash: await hashPassword("ApiKeyTest-2026!"),
        })
        .returning();
      users.push(user!.id);
      const login = await app.inject({
        method: "POST",
        url: "/api/app/auth/login",
        payload: { account: user!.account, password: "ApiKeyTest-2026!" },
      });
      expect(login.statusCode).toBe(200);
      if (suffix === "owner") ownerToken = login.json().token;
      else if (suffix === "member") memberToken = login.json().token;
    }
    const result = await app.inject({
      method: "POST",
      url: "/api/app/spaces",
      headers: header(),
      payload: { name: "AI验收空间" },
    });
    expect(result.statusCode).toBe(200);
    spaceId = result.json().id;
    spaceIds.push(spaceId);
    await db.db.insert(spaceMembers).values([
      { spaceId, userId: users[1]! },
      { spaceId, userId: users[2]! },
    ]);
  });
  afterAll(async () => {
    await app?.close();
    if (fileIds.length)
      await db.db.delete(files).where(inArray(files.id, fileIds));
    if (spaceIds.length)
      await db.db.delete(spaces).where(inArray(spaces.id, spaceIds));
    if (users.length)
      await db.db.delete(appUsers).where(inArray(appUsers.id, users));
    await db.close();
  });
  test("AI密钥额度在HTTP和MCP间共享，跨IP不重置，不同密钥独立", async () => {
    const first = (await issue(["read"], ownerToken)).json().secret as string;
    const second = (await issue(["read"], ownerToken)).json().secret as string;
    const limited = Fastify({ logger: false });
    registerAiRateLimit(limited, db, 2);
    limited.setErrorHandler((error, _request, reply) => {
      reply.code(error instanceof AppError ? error.statusCode : 500).send({
        code: error instanceof AppError ? error.code : "INTERNAL_ERROR",
      });
    });
    limited.get("/api/v1/rate-test", async () => ({ ok: true }));
    limited.post("/mcp", async () => ({ ok: true }));
    try {
      const call = (key: string, method: "GET" | "POST", address: string) =>
        limited.inject({
          method,
          url: method === "GET" ? "/api/v1/rate-test" : "/mcp",
          remoteAddress: address,
          headers: header(key),
        });
      expect((await call(first, "GET", "192.0.2.1")).statusCode).toBe(200);
      expect((await call(first, "POST", "192.0.2.2")).statusCode).toBe(200);
      const rejected = await call(first, "GET", "192.0.2.3");
      expect(rejected.statusCode).toBe(429);
      expect(rejected.json().code).toBe("AI_RATE_LIMITED");
      expect(Number(rejected.headers["retry-after"])).toBeGreaterThan(0);
      expect((await call(second, "GET", "192.0.2.1")).statusCode).toBe(200);
      const secondKey = await db.db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.tokenHash, hashToken(second)));
      await app.inject({
        method: "DELETE",
        url: `/api/app/api-keys/${secondKey[0]!.id}`,
        headers: header(),
      });
      expect((await call(second, "GET", "192.0.2.1")).statusCode).toBe(401);
    } finally {
      await limited.close();
    }
  });
  test("独立授权、创建者查看原文、负责人管理、修改即时生效与物理删除", async () => {
    const issued = await issue(["read"]);
    expect(issued.statusCode).toBe(200);
    const { secret, key } = issued.json();
    const list = await app.inject({
      url: `/api/app/spaces/${spaceId}/api-keys`,
      headers: header(),
    });
    expect(list.body).not.toContain(secret);
    expect(list.body).not.toContain("encryptedSecret");
    expect(list.body).not.toContain("tokenHash");
    const reveal = await app.inject({
      method: "POST",
      url: `/api/app/api-keys/${key.id}/reveal`,
      headers: header(memberToken),
      payload: {},
    });
    expect(reveal.statusCode).toBe(200);
    expect(reveal.json().secret).toBe(secret);
    expect(reveal.headers["cache-control"]).toBe("no-store");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/app/api-keys/${key.id}/reveal`,
          headers: header(),
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    await expect(authorizeAi(db.db, secret, "edit")).rejects.toThrow("未授予");
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/app/api-keys/${key.id}`,
          headers: header(),
          payload: { name: "已修改", permissions: ["edit"] },
        })
      ).statusCode,
    ).toBe(200);
    await expect(authorizeAi(db.db, secret, "read")).rejects.toThrow("未授予");
    expect((await authorizeAi(db.db, secret, "edit")).permissions).toEqual([
      "edit",
    ]);
    const [stored] = await db.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, key.id));
    expect(stored!.encryptedSecret).not.toContain(secret);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/app/api-keys/${key.id}`,
          headers: header(memberToken),
          payload: { name: "空权限", permissions: [] },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/app/api-keys/${key.id}`,
          headers: header(),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      await db.db.select().from(apiKeys).where(eq(apiKeys.id, key.id)),
    ).toHaveLength(0);
    await expect(authorizeAi(db.db, secret, "read")).rejects.toThrow("无效");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/app/api-keys/${key.id}/reveal`,
          headers: header(memberToken),
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  });
  test("其他成员不能修改、删除或查看他人密钥；旧密钥原文不可恢复", async () => {
    const issued = (await issue(["read"], ownerToken)).json();
    const path = `/api/app/api-keys/${issued.key.id}`;
    for (const [method, url, payload] of [
      ["POST", `${path}/reveal`, {}],
      ["PATCH", path, { name: "越权", permissions: ["edit"] }],
      ["DELETE", path, undefined],
    ] as const) {
      expect(
        (
          await app.inject({
            method,
            url,
            headers: header(memberToken),
            ...(payload ? { payload } : {}),
          })
        ).statusCode,
      ).toBe(403);
    }
    const list = await app.inject({
      url: `/api/app/spaces/${spaceId}/api-keys`,
      headers: header(memberToken),
    });
    expect(list.body).not.toContain(issued.key.id);
    expect(
      (await app.inject({ method: "POST", url: `${path}/reveal`, payload: {} }))
        .statusCode,
    ).toBe(401);
    await db.db
      .update(apiKeys)
      .set({ encryptedSecret: null })
      .where(eq(apiKeys.id, issued.key.id));
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${path}/reveal`,
          headers: header(),
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    expect((await authorizeAi(db.db, issued.secret, "read")).keyId).toBe(
      issued.key.id,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/app/spaces/${spaceId}/api-keys`,
          headers: header(),
          payload: {
            name: "未来日期",
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          },
        })
      ).statusCode,
    ).toBe(400);
  });
  test("成员移除、账号停用与过期每次请求实时失效", async () => {
    const issued = await issue(["read"]);
    expect(issued.statusCode).toBe(200);
    const { secret, key } = issued.json();
    await db.db
      .update(apiKeys)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apiKeys.id, key.id));
    await expect(authorizeAi(db.db, secret)).rejects.toThrow("过期");
    await db.db
      .update(apiKeys)
      .set({ expiresAt: null })
      .where(eq(apiKeys.id, key.id));
    await db.db
      .update(appUsers)
      .set({ status: "disabled" })
      .where(eq(appUsers.id, users[1]!));
    await expect(authorizeAi(db.db, secret)).rejects.toThrow("无权");
    await db.db
      .update(appUsers)
      .set({ status: "enabled" })
      .where(eq(appUsers.id, users[1]!));
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/app/spaces/${spaceId}/members/${users[1]}`,
      headers: header(),
    });
    expect(removed.statusCode).toBe(200);
    await expect(authorizeAi(db.db, secret)).rejects.toThrow("无权");
    await expect(authorizeAi(db.db, ownerToken)).rejects.toThrow("无效");
  });
  test("AI文档HTTP使用独立密钥、原子批次与事务幂等结果", async () => {
    const readonly = await issue(["read"], ownerToken);
    const editable = await issue(["read", "edit"], ownerToken);
    expect(editable.statusCode).toBe(200);
    const secret = editable.json<{ secret: string }>().secret;
    const readSecret = readonly.json<{ secret: string }>().secret;
    const created = await app.inject({
      method: "POST",
      url: `/api/app/spaces/${spaceId}/files`,
      headers: header(),
      payload: { name: "AI正文验收", kind: "doc" },
    });
    expect(created.statusCode).toBe(200);
    const fileId = created.json<{ id: string }>().id;
    fileIds.push(fileId);
    const endpoint = `/api/v1/files/${fileId}/document`;
    expect(
      (await app.inject({ url: endpoint, headers: header() })).statusCode,
    ).toBe(401);
    const original = await app.inject({
      url: endpoint,
      headers: header(secret),
    });
    expect(original.statusCode).toBe(200);
    const current = original.json<{ revision: number; epoch: number }>();
    const body = {
      requestId: "ai-request-0001",
      expectedRevision: current.revision,
      expectedEpoch: current.epoch,
      operations: [
        {
          type: "insert_blocks",
          blocks: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "AI写入服务器" }],
            },
          ],
        },
      ],
    };
    const write = (payload = body, key = secret) =>
      app.inject({
        method: "PATCH",
        url: endpoint,
        headers: header(key),
        payload,
      });
    expect((await write(body, readSecret)).statusCode).toBe(403);
    const committed = await write();
    expect(committed.statusCode).toBe(200);
    expect(committed.json<{ epoch: number }>().epoch).toBe(current.epoch);
    const replay = await write();
    expect(replay.statusCode).toBe(200);
    expect(replay.body).toBe(committed.body);
    expect(
      (
        await write({
          ...body,
          operations: [
            {
              type: "insert_blocks",
              blocks: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "另一请求" }],
                },
              ],
            },
          ],
        })
      ).statusCode,
    ).toBe(409);
    const final = await app.inject({ url: endpoint, headers: header(secret) });
    expect(final.body.match(/AI写入服务器/g)).toHaveLength(1);
    expect(final.json<{ revision: number }>().revision).toBe(
      current.revision + 1,
    );
    const malformed = await app.inject({
      method: "PATCH",
      url: endpoint,
      headers: header(secret),
      payload: {
        ...body,
        requestId: "ai-request-0002",
        expectedRevision: current.revision + 1,
        operations: [
          ...body.operations,
          { type: "delete_block", blockId: "missing-block" },
        ],
      },
    });
    expect(malformed.statusCode).toBe(409);
    expect(malformed.json<{ code: string }>().code).toBe(
      "BLOCK_TARGET_INVALID",
    );
    const untouched = await app.inject({
      url: endpoint,
      headers: header(secret),
    });
    expect(untouched.body).toBe(final.body);
    const stale = await app.inject({
      method: "PATCH",
      url: endpoint,
      headers: header(secret),
      payload: { ...body, requestId: "ai-stale-document-0003" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: "CONTENT_CONFLICT",
      currentRevision: current.revision + 1,
      currentEpoch: current.epoch,
    });
    const markdownInput = {
      expectedRevision: current.revision + 1,
      expectedEpoch: current.epoch,
      requestId: "ai-markdown-document-0004",
      operations: [
        {
          type: "insert_blocks",
          markdown: "## 服务端解析\n\n**重点**\n\n- [x] 完成",
        },
      ],
    };
    const markdown = await app.inject({
      method: "PATCH",
      url: endpoint,
      headers: header(secret),
      payload: markdownInput,
    });
    expect(markdown.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: endpoint,
          headers: header(secret),
          payload: markdownInput,
        })
      ).body,
    ).toBe(markdown.body);
    const ambiguous = await app.inject({
      method: "PATCH",
      url: endpoint,
      headers: header(secret),
      payload: {
        ...markdownInput,
        requestId: "ai-markdown-document-0005",
        expectedRevision: current.revision + 2,
        operations: [
          {
            type: "insert_blocks",
            markdown: "正文",
            blocks: [{ type: "paragraph" }],
          },
        ],
      },
    });
    expect(ambiguous.statusCode).toBe(400);
    const mcp = (payload: Record<string, unknown>, key = secret) =>
      app.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          ...header(key),
          host: new URL(
            process.env.APP_PUBLIC_ORIGIN ?? "http://127.0.0.1:9811",
          ).host,
          accept: "application/json, text/event-stream",
        },
        payload,
      });
    const initialized = await mcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "minmd-test", version: "1.0.0" },
      },
    });
    expect(initialized.statusCode).toBe(200);
    const discovered = await mcp({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(discovered.statusCode).toBe(200);
    expect(discovered.body).toContain("read_document");
    const readMcp = await mcp({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "read_document", arguments: { fileId } },
    });
    expect(readMcp.statusCode).toBe(200);
    expect(readMcp.body).toContain("AI写入服务器");
    const deniedMcp = await mcp(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "update_document", arguments: { fileId, ...body } },
      },
      readSecret,
    );
    expect(deniedMcp.body).toContain("AI_PERMISSION_DENIED");
    expect(
      (await mcp({ jsonrpc: "2.0", id: 5, method: "tools/list" }, ownerToken))
        .statusCode,
    ).toBe(401);
    const blockedCreate = await app.inject({
      method: "POST",
      url: "/api/app/spaces",
      headers: header(secret),
      payload: { name: "不允许AI创建空间" },
    });
    expect(blockedCreate.statusCode).toBe(401);
    await app.inject({
      method: "DELETE",
      url: `/api/app/files/${fileId}`,
      headers: header(),
    });
    await app.inject({
      method: "POST",
      url: `/api/app/files/${fileId}/purge`,
      headers: header(),
      payload: { confirm: true },
    });
  });
});
