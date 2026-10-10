import { describe, expect, test } from "bun:test";
import { loadConfig } from "../system/server/src/config/env";

describe("configuration", () => {
  test("validates environment and PostgreSQL connection", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://localhost/example",
    });
    expect(config.APP_ENV).toBe("development");
    expect(config.PORT).toBe(9811);
    expect(config.PUBLIC_ORIGIN).toBe("http://127.0.0.1:9811");
  });
  test("rejects missing or invalid settings without leaking credentials", () => {
    expect(() => loadConfig({})).toThrow("DATABASE_URL");
    expect(() =>
      loadConfig({ DATABASE_URL: "mysql://user:secret@localhost/db" }),
    ).toThrow("DATABASE_URL");
    expect(() =>
      loadConfig({ DATABASE_URL: "postgresql://localhost/db", PORT: "0" }),
    ).toThrow("PORT");
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgresql://localhost/db",
        APP_ENV: "prod",
      }),
    ).toThrow("APP_ENV");
    try {
      loadConfig({ DATABASE_URL: "secret" });
    } catch (error) {
      expect(String(error)).not.toContain("secret");
    }
  });
});

test("authentication configuration rejects unsafe or invalid options", () => {
  const base = { DATABASE_URL: "postgresql://localhost/db" };
  expect(loadConfig(base).AUTH_TRANSPORT).toBe("bearer");
  expect(loadConfig(base).AUTH_TOKEN_STORAGE).toBe("sessionStorage");
  for (const extra of [
    { AUTH_TRANSPORT: "jwt" },
    { AUTH_TOKEN_STORAGE: "unknown" },
    { AUTH_SESSION_HOURS: "0" },
    { CORS_ORIGINS: "*" },
    { PUBLIC_ORIGIN: "http://localhost/path" },
    {
      APP_ENV: "production",
      AUTH_TRANSPORT: "cookie",
      PUBLIC_ORIGIN: "http://localhost",
    },
  ])
    expect(() => loadConfig({ ...base, ...extra })).toThrow(
      "Invalid configuration",
    );
  expect(
    loadConfig({
      ...base,
      APP_ENV: "production",
      AUTH_TRANSPORT: "cookie",
      PUBLIC_ORIGIN: "https://web-cms.example.com",
    }).AUTH_TRANSPORT,
  ).toBe("cookie");
});
