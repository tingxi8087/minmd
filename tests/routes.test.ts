import type { FastifyContextConfig } from "fastify";
import { expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { buildApp } from "../apps/app_server/src/app";
import { loadConfig } from "../system/server/src/config/env";

const config = loadConfig({
  DATABASE_URL: "postgresql://localhost/unused_test",
  APP_ENV: "development",
  LOG_LEVEL: "silent",
});
test("routes without explicit auth or response contracts fail registration", async () => {
  for (const schema of [undefined, { response: { 200: Type.Null() } }]) {
    const app = await buildApp(config);
    try {
      expect(() =>
        app.get("/api/incomplete", { schema }, async () => null),
      ).toThrow("explicit auth and response schema");
    } finally {
      await app.close();
    }
  }
});
test("write routes require request schemas", async () => {
  const app = await buildApp(config);
  try {
    expect(() =>
      app.post(
        "/api/incomplete",
        { config: { auth: false }, schema: { response: { 200: Type.Null() } } },
        async () => null,
      ),
    ).toThrow("body schema");
  } finally {
    await app.close();
  }
});
test("unknown permission and public privilege declarations fail registration", async () => {
  for (const access of [
    { auth: true, permissions: ["typo:read"] },
    { auth: false, superAdmin: true },
  ]) {
    const app = await buildApp(config);
    try {
      expect(() =>
        app.get(
          "/api/invalid-access",
          {
            config: access as FastifyContextConfig,
            schema: { response: { 200: Type.Null() } },
          },
          async () => null,
        ),
      ).toThrow();
    } finally {
      await app.close();
    }
  }
});
