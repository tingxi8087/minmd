import { describe, expect, test } from "bun:test";
import { loadConfig } from "../system/server/src/config/env";

describe("configuration", () => {
  test("validates environment and PostgreSQL connection", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://localhost/example",
    });
    expect(config.APP_ENV).toBe("development");
    expect(config.PORT).toBe(9811);
    expect(config.HTTP_BODY_LIMIT_BYTES).toBe(16777216);
    expect(config.TRUST_PROXY_ADDRESSES).toEqual([]);
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

test("proxy trust requires explicit IP addresses or CIDR", () => {
  const base = { DATABASE_URL: "postgresql://localhost/unused_test" };
  expect(
    loadConfig({
      ...base,
      TRUST_PROXY_ADDRESSES: "127.0.0.1, 172.28.0.0/24, ::1",
    }).TRUST_PROXY_ADDRESSES,
  ).toEqual(["127.0.0.1", "172.28.0.0/24", "::1"]);
  for (const value of [
    "true",
    "1",
    "*",
    "localhost",
    "127.0.0.1/33",
    "::1/129",
    "127.0.0.1/8/2",
  ]) {
    expect(() => loadConfig({ ...base, TRUST_PROXY_ADDRESSES: value })).toThrow(
      "TRUST_PROXY_ADDRESSES",
    );
  }
  for (const value of ["0", "1048575", "67108865", "1.5"]) {
    expect(() => loadConfig({ ...base, HTTP_BODY_LIMIT_BYTES: value })).toThrow(
      "HTTP_BODY_LIMIT_BYTES",
    );
  }
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

test("HTTP IP 直连是显式且受限的生产例外，HTTPS 默认行为不变", () => {
  const base = {
    DATABASE_URL: "postgresql://localhost/unused_test",
    APP_ENV: "production",
    AUTH_TRANSPORT: "cookie",
    PUBLIC_ORIGIN: "http://192.168.1.10:9811",
    HTTP_IP_DIRECT: "true",
  };
  expect(loadConfig(base).HTTP_IP_DIRECT).toBe(true);
  expect(() => loadConfig({ ...base, HTTP_IP_DIRECT: "false" })).toThrow(
    "HTTPS",
  );
  for (const extra of [
    { PUBLIC_ORIGIN: "http://docs.example.com:9811" },
    { PUBLIC_ORIGIN: "https://192.168.1.10:9811" },
    { PUBLIC_ORIGIN: "http://0.0.0.0:9811" },
    { PUBLIC_ORIGIN: "http://255.255.255.255:9811" },
    { PUBLIC_ORIGIN: "http://[::1]:9811" },
    { AUTH_TRANSPORT: "bearer" },
    { TRUST_PROXY_ADDRESSES: "127.0.0.1" },
    { HTTP_IP_DIRECT: "yes" },
  ])
    expect(() => loadConfig({ ...base, ...extra })).toThrow(
      "Invalid configuration",
    );
  expect(
    loadConfig({
      ...base,
      PUBLIC_ORIGIN: "https://docs.example.com",
      HTTP_IP_DIRECT: "false",
    }).HTTP_IP_DIRECT,
  ).toBe(false);
});
