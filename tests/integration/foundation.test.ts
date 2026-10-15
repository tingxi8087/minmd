import {
  admins,
  auditLogs,
} from "../../system/server/src/database/schema/system";
import { hashPassword } from "../../system/server/src/modules/auth/password";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { Type } from "@sinclair/typebox";
import { buildApp } from "../../apps/app_server/src/app";

import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";

const url = process.env.TEST_DATABASE_URL;
// Integration tests require an explicitly supplied, dedicated test database.
if (
  url &&
  !new URL(url).pathname.endsWith("_test") &&
  new URL(url).pathname !== "/mas_backend"
)
  throw new Error(
    "TEST_DATABASE_URL must point to mas_backend or a database ending in _test",
  );
const suite = url ? describe : describe.skip;

suite("PostgreSQL foundation", () => {
  const config = loadConfig({
    WEB_CMS_DIST: "tests/fixtures/web-cms",
    WEB_DIST: "tests/fixtures/web",
    DATABASE_URL: url ?? "postgresql://localhost/unused_test",
    LOG_LEVEL: "info",
  });
  const database = createDatabase(config.DATABASE_URL);
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk, _, callback) {
      logs.push(String(chunk));
      callback();
    },
  });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let actorId: string;
  let token: string;
  const headers = () => ({ authorization: `Bearer ${token}` });
  beforeAll(async () => {
    const migrationsFolder = resolve("database/migrations");
    await migrate(database.db, { migrationsFolder });
    await migrate(database.db, { migrationsFolder });
    app = await buildApp(config, { logger: { stream } });
    app.get(
      "/api/test-error",
      { config: { auth: false }, schema: { response: { 200: Type.Null() } } },
      async () => {
        throw new Error("secret-database-password");
      },
    );
    app.get(
      "/api/test-protected",
      { config: { auth: true }, schema: { response: { 200: Type.Null() } } },
      async () => null,
    );
    await app.ready();
    const [actor] = await database.db
      .insert(admins)
      .values({
        account: `foundation_${Date.now()}`,
        displayName: "Fixture",
        passwordHash: await hashPassword("Fixture-password-123"),
      })
      .returning();
    actorId = actor!.id;
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { account: actor!.account, password: "Fixture-password-123" },
    });
    token = login.json().token;
  });
  afterAll(async () => {
    await app?.close();
    await database.db.delete(admins).where(eq(admins.id, actorId));
    await database.db.delete(auditLogs).where(eq(auditLogs.actorId, actorId));
    await database.close();
  });
  test("health checks a real connection", async () => {
    const response = await app.inject("/api/health");
    expect(response.statusCode).toBe(200);
    expect(response.json().database).toBe("connected");
    expect(response.headers["x-request-id"]).toBeTruthy();
  });
  test("forwarded client addresses require explicit proxy trust", async () => {
    for (const trusted of [false, true]) {
      const candidate = await buildApp({
        ...config,
        LOG_LEVEL: "silent",
        TRUST_PROXY_ADDRESSES: trusted ? ["127.0.0.1"] : [],
      });
      try {
        candidate.get(
          "/api/test-client-address",
          {
            config: { auth: false },
            schema: { response: { 200: Type.Object({ ip: Type.String() }) } },
          },
          async (request) => ({ ip: request.ip }),
        );
        const response = await candidate.inject({
          url: "/api/test-client-address",
          remoteAddress: "127.0.0.1",
          headers: { "x-forwarded-for": "198.51.100.9, 192.0.2.8" },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().ip).toBe(trusted ? "192.0.2.8" : "127.0.0.1");
        const direct = await candidate.inject({
          url: "/api/test-client-address",
          remoteAddress: "203.0.113.4",
          headers: { "x-forwarded-for": "198.51.100.9" },
        });
        expect(direct.json().ip).toBe("203.0.113.4");
      } finally {
        await candidate.close();
      }
    }
  });
  test("JSON body limits accept document-sized payloads and reject oversize", async () => {
    const candidate = await buildApp({
      ...config,
      LOG_LEVEL: "silent",
      HTTP_BODY_LIMIT_BYTES: 3 * 1024 * 1024,
    });
    try {
      candidate.post<{ Body: { text: string } }>(
        "/api/test-body-limit",
        {
          config: { auth: false },
          schema: {
            body: Type.Object(
              { text: Type.String() },
              { additionalProperties: false },
            ),
            response: { 200: Type.Object({ length: Type.Integer() }) },
          },
        },
        async (request) => ({ length: request.body.text.length }),
      );
      const accepted = await candidate.inject({
        method: "POST",
        url: "/api/test-body-limit",
        payload: { text: "x".repeat(2 * 1024 * 1024) },
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json().length).toBe(2 * 1024 * 1024);
      const rejected = await candidate.inject({
        method: "POST",
        url: "/api/test-body-limit",
        payload: { text: "x".repeat(4 * 1024 * 1024) },
      });
      expect(rejected.statusCode).toBe(413);
    } finally {
      await candidate.close();
    }
  });
  test("database transactions roll back", async () => {
    const id = crypto.randomUUID();
    await expect(
      database.db.transaction(async (tx) => {
        await tx.insert(admins).values({
          id,
          account: "rollback",
          displayName: "Test",
          passwordHash: "unused",
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(
      await database.db.select().from(admins).where(eq(admins.id, id)),
    ).toHaveLength(0);
  });
  test("unexpected errors are redacted and correlate with logs", async () => {
    const response = await app.inject({
      url: "/api/test-error?password=secret-query",
      headers: {
        authorization: "Bearer secret-token",
        "x-request-id": "forged",
      },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json().code).toBe("INTERNAL_ERROR");
    expect(response.json().requestId).not.toBe("forged");
    expect(response.body).not.toContain("secret");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const output = logs.join("");
    expect(output).toContain(response.json().requestId);
    expect(output).not.toContain("secret-database-password");
    expect(output).not.toContain("secret-query");
    expect(output).not.toContain("secret-token");
    await app.inject(
      "/api/public/shares/secret-path-token?token=secret-query-token",
    );
    const afterUnknown = logs.join("");
    expect(afterUnknown).not.toContain("secret-path-token");
    expect(afterUnknown).not.toContain("secret-query-token");
  });
  test("unauthenticated requests fail closed", async () => {
    expect((await app.inject("/api/test-protected")).statusCode).toBe(401);
  });
  test("OpenAPI discovers declared routes and parameters", async () => {
    expect((await app.inject("/api/openapi.json")).statusCode).toBe(401);
    const document = app.swagger() as { paths: Record<string, any> };
    expect(
      document.paths["/api/admin/app-users"].post.requestBody,
    ).toBeTruthy();
    expect(
      document.paths["/api/admin/app-users"].get.parameters.length,
    ).toBeGreaterThan(0);
  });
  test("production requires login for user management and discovery", async () => {
    const production = await buildApp({ ...config, APP_ENV: "production" });
    try {
      expect(
        (
          await production.inject({
            method: "POST",
            url: "/api/admin/app-users",
            payload: {},
          })
        ).statusCode,
      ).toBe(401);
      expect((await production.inject("/api/openapi.json")).statusCode).toBe(
        401,
      );
      expect(
        (await production.inject("/api/system/environment")).json().environment,
      ).toBe("production");
    } finally {
      await production.close();
    }
  });
});
