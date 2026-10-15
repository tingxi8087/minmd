import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { loadConfig } from "../system/server/src/config/env";
import { installWebFrontend } from "../system/server/src/plugins/web-frontend";
import { installWebCms } from "../system/server/src/plugins/web-cms";
import { installPublicStatic } from "../system/server/src/plugins/public-static";
import { installSecurity } from "../system/server/src/plugins/security";
import { loadMinmdConfig } from "../config/minmd";

test("统一静态入口区分前后台资源，保留 API/MCP 和缺失资源的 404，保护隐藏及目录外文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "minmd-web-host-"));
  const web = join(root, "web"),
    cms = join(root, "cms"),
    pub = join(root, "public");
  for (const path of [
    web,
    cms,
    pub,
    join(web, "assets"),
    join(cms, "assets"),
    join(web, "api"),
    join(web, "mcp"),
  ])
    await mkdir(path, { recursive: true });
  await writeFile(join(web, "index.html"), "<html>front</html>");
  await writeFile(join(cms, "index.html"), "<html>admin</html>");
  await writeFile(join(web, "assets/app-123.js"), "front-script");
  await writeFile(join(cms, "assets/app-123.js"), "admin-script");
  await writeFile(join(web, "api/leak"), "must-not-expose");
  await writeFile(join(web, "mcp/leak"), "must-not-expose");
  await writeFile(join(web, ".env"), "must-not-expose");
  await writeFile(join(root, "secret"), "must-not-expose");
  await symlink(join(root, "secret"), join(web, "outside"));
  await writeFile(join(pub, "avatar.txt"), "public-file");
  const config = loadConfig({
    DATABASE_URL: "postgresql://localhost/unused_test",
    APP_ENV: "production",
    PUBLIC_ORIGIN: "https://docs.example.com",
    WEB_DIST: web,
    WEB_CMS_DIST: cms,
    WEB_CMS_PATH: "/admin",
    STATIC_DIR: pub,
  });
  const app = Fastify();
  try {
    await installSecurity(app, config);
    app.get("/api/protected", async (_, reply) =>
      reply.code(401).send({ code: "UNAUTHENTICATED" }),
    );
    app.post("/mcp", async () => ({ service: "mcp" }));
    await installWebFrontend(app, config);
    await installWebCms(app, config);
    await installPublicStatic(app, config);
    const home = await app.inject("/");
    expect(home.body).toBe("<html>front</html>");
    expect(home.headers["cache-control"]).toBe("no-store");
    expect(home.headers["content-security-policy"]).toContain("blob:");
    expect(home.headers["content-security-policy"]).toContain(
      "wss://docs.example.com",
    );
    expect((await app.inject({ method: "HEAD", url: "/" })).body).toBe("");
    expect((await app.inject("/admin")).headers.location).toBe("/admin/");
    const admin = await app.inject("/admin/");
    expect(admin.body).toBe("<html>admin</html>");
    expect(admin.headers["content-security-policy"]).not.toContain(
      "unsafe-eval",
    );
    expect((await app.inject("/assets/app-123.js")).body).toBe("front-script");
    expect(
      (await app.inject("/assets/app-123.js")).headers["cache-control"],
    ).toContain("immutable");
    expect((await app.inject("/admin/assets/app-123.js")).body).toBe(
      "admin-script",
    );
    expect((await app.inject("/public/avatar.txt")).body).toBe("public-file");
    const api = await app.inject("/api/protected");
    expect(api.statusCode).toBe(401);
    expect(api.headers["content-security-policy"]).not.toContain("unsafe-eval");
    expect(
      (await app.inject({ method: "POST", url: "/mcp" })).json<{
        service: string;
      }>(),
    ).toEqual({
      service: "mcp",
    });
    for (const path of [
      "/api/missing",
      "/api/leak",
      "/mcp/leak",
      "/assets/missing.js",
      "/admin/missing.js",
      "/public/missing",
      "/.env",
      "/outside",
      "/unknown",
    ])
      expect((await app.inject(path)).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/" })).statusCode).toBe(
      404,
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("开发不挂载构建产物，部署缺少前台构建或路径冲突时明确失败；附件不得位于前台静态目录内", async () => {
  const env = {
    DATABASE_URL: "postgresql://localhost/unused_test",
    WEB_DIST: "/nonexistent/minmd-web",
  };
  const dev = Fastify();
  await installWebFrontend(dev, loadConfig(env));
  expect((await dev.inject("/")).statusCode).toBe(404);
  await dev.close();
  for (const environment of ["staging", "production"]) {
    const app = Fastify();
    try {
      await expect(
        installWebFrontend(app, loadConfig({ ...env, APP_ENV: environment })),
      ).rejects.toThrow("Web frontend build missing");
    } finally {
      await app.close();
    }
  }
  for (const path of ["/", "/assets", "/mcp"]) {
    const app = Fastify();
    try {
      await expect(
        installWebFrontend(
          app,
          loadConfig({ ...env, APP_ENV: "staging", WEB_CMS_PATH: path }),
        ),
      ).rejects.toThrow("前后台同时托管");
    } finally {
      await app.close();
    }
  }
  expect(() =>
    loadMinmdConfig(loadConfig(env), {
      ASSET_STORAGE_DIR: "/nonexistent/minmd-web/private",
    }),
  ).toThrow("outside static directories");
});

test("HTTP IP 直连前后台不强制升级 HTTPS，仍保留 CSP 与来源一致性校验", async () => {
  const config = loadConfig({
    DATABASE_URL: "postgresql://localhost/unused_test",
    APP_ENV: "production",
    AUTH_TRANSPORT: "cookie",
    HTTP_IP_DIRECT: "true",
    PUBLIC_ORIGIN: "http://192.168.1.10:9811",
    WEB_DIST: "tests/fixtures/web",
    WEB_CMS_DIST: "tests/fixtures/web-cms",
    WEB_CMS_PATH: "/admin",
  });
  const app = Fastify();
  try {
    expect(() =>
      loadMinmdConfig(config, {
        APP_PUBLIC_ORIGIN: "http://192.168.1.11:9811",
      }),
    ).toThrow("APP_PUBLIC_ORIGIN");
    expect(loadMinmdConfig(config, {}).allowedOrigins).toEqual([
      config.PUBLIC_ORIGIN,
    ]);
    await installSecurity(app, config);
    await installWebFrontend(app, config);
    await installWebCms(app, config);
    for (const path of ["/", "/admin/"]) {
      const response = await app.inject(path);
      expect(response.statusCode).toBe(200);
      expect(response.headers["strict-transport-security"]).toBeUndefined();
      expect(response.headers["content-security-policy"]).toContain(
        "default-src 'self'",
      );
      expect(response.headers["content-security-policy"]).not.toContain(
        "upgrade-insecure-requests",
      );
    }
    expect(
      (await app.inject("/")).headers["content-security-policy"],
    ).toContain("ws://192.168.1.10:9811");
  } finally {
    await app.close();
  }
});
