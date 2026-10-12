import { expect, test } from "bun:test";
import Fastify from "fastify";
import { registerDevWeb } from "../apps/app_server/src/modules/dev-web";
import { loadConfig } from "../system/server/src/config/env";
import { loadDevConfig } from "../config/dev";

test("开发网页分别代理到本机 Vite，保留查询参数，接口不回流", async () => {
  const web = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) =>
      new Response(
        `web:${new URL(req.url).pathname}${new URL(req.url).search}`,
      ),
  });
  const cms = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) => new Response(`cms:${new URL(req.url).pathname}`),
  });
  const before = {
    WEB_PORT: process.env.WEB_PORT,
    WEB_CMS_PORT: process.env.WEB_CMS_PORT,
    WEB_DEV_PROXY: process.env.WEB_DEV_PROXY,
  };
  const app = Fastify();
  process.env.WEB_PORT = String(web.port);
  process.env.WEB_CMS_PORT = String(cms.port);
  process.env.WEB_DEV_PROXY = "true";
  try {
    app.get("/api/health", async () => ({ status: "ok" }));
    app.post("/mcp", async () => ({ service: "mcp" }));
    await registerDevWeb(
      app,
      loadConfig({
        DATABASE_URL: "postgresql://localhost/unused_test",
        WEB_CMS_PATH: "/admin",
      }),
    );
    expect((await app.inject("/")).body).toBe("web:/");
    expect((await app.inject("/src/main.tsx?t=123")).body).toBe(
      "web:/src/main.tsx?t=123",
    );
    expect((await app.inject("/admin")).headers.location).toBe("/admin/");
    expect((await app.inject("/admin/")).body).toBe("cms:/admin/");
    expect((await app.inject("/admin/src/main.tsx")).body).toBe(
      "cms:/admin/src/main.tsx",
    );
    expect((await app.inject("/api/health")).json().status).toBe("ok");
    expect(
      (await app.inject({ method: "POST", url: "/mcp" })).json().service,
    ).toBe("mcp");
    for (const url of ["/api/not-found", "/mcp/not-found"])
      expect((await app.inject(url)).statusCode).toBe(404);
    expect(
      (await app.inject({ method: "POST", url: "/src/main.tsx" })).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
    await web.stop(true);
    await cms.stop(true);
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("预发与正式环境不启用源码代理", async () => {
  for (const environment of ["staging", "production"]) {
    const app = Fastify();
    try {
      await registerDevWeb(
        app,
        loadConfig({
          APP_ENV: environment,
          DATABASE_URL: "postgresql://localhost/unused_test",
        }),
      );
      expect((await app.inject("/")).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  }
});

test("开发代理配置拒绝重复端口及无效开关", () => {
  expect(loadDevConfig({}).enabled).toBe(true);
  expect(loadDevConfig({ WEB_DEV_PROXY: "false" }).enabled).toBe(false);
  expect(() => loadDevConfig({ WEB_DEV_PROXY: "yes" })).toThrow();
  expect(() => loadDevConfig({ WEB_PORT: "9811" })).toThrow();
});
