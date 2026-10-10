import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { loadConfig } from "../system/server/src/config/env";
import { installWebCms } from "../system/server/src/plugins/web-cms";

test("development skips static CMS even without build output; deployed environments require it", async () => {
  for (const environment of ["development", "staging", "production"]) {
    const app = Fastify();
    try {
      const install = installWebCms(
        app,
        loadConfig({
          DATABASE_URL: "postgresql://localhost/unused_test",
          APP_ENV: environment,
          WEB_CMS_DIST: "/nonexistent/mas-web-cms-build",
        }),
      );
      if (environment === "development") {
        await install;
        expect((await app.inject("/web-cms/")).statusCode).toBe(404);
      } else {
        await expect(install).rejects.toThrow("Web CMS build missing");
      }
    } finally {
      await app.close();
    }
  }
});

test("Web CMS paths default, normalize and reject API collisions and non-path values", () => {
  const env = { DATABASE_URL: "postgresql://localhost/unused_test" };
  expect(loadConfig(env).WEB_CMS_PATH).toBe("/web-cms");
  expect(
    loadConfig({ ...env, WEB_CMS_PATH: "/tools/admin/" }).WEB_CMS_PATH,
  ).toBe("/tools/admin");
  for (const path of [
    "",
    "admin",
    "//host",
    "/api",
    "/api/admin",
    "/a/../b",
    "/admin?x=1",
    "/admin#login",
  ])
    expect(() => loadConfig({ ...env, WEB_CMS_PATH: path })).toThrow(
      "WEB_CMS_PATH",
    );
});

test("static CMS serves configured paths without redirecting the site root", async () => {
  const root = await mkdtemp(join(tmpdir(), "web-cms-path-"));
  try {
    await writeFile(join(root, "index.html"), "cms fixture");
    for (const [path, environment] of [
      ["/web-cms", "staging"],
      ["/tools/admin", "production"],
      ["/", "production"],
    ]) {
      const app = Fastify();
      try {
        await installWebCms(
          app,
          loadConfig({
            DATABASE_URL: "postgresql://localhost/unused_test",
            APP_ENV: environment,
            WEB_CMS_DIST: root,
            WEB_CMS_PATH: path,
          }),
        );
        const prefix = path === "/" ? "/" : `${path}/`;
        expect((await app.inject(prefix)).body).toBe("cms fixture");
        if (path !== "/") {
          const response = await app.inject("/");
          expect(response.statusCode).toBe(404);
          expect(response.headers.location).toBeUndefined();
          expect((await app.inject(path)).headers.location).toBe(prefix);
        }
      } finally {
        await app.close();
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
