import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { loadConfig } from "../system/server/src/config/env";
import { installPublicStatic } from "../system/server/src/plugins/public-static";
import { installWebCms } from "../system/server/src/plugins/web-cms";

test("static configuration rejects invalid and overlapping URL prefixes", () => {
  const env = { DATABASE_URL: "postgresql://localhost/unused_test" };
  expect(loadConfig(env).STATIC_PATH).toBe("/public");
  expect(loadConfig({ ...env, STATIC_PATH: "/files/" }).STATIC_PATH).toBe(
    "/files",
  );
  for (const path of [
    "/",
    "/api",
    "/api/files",
    "/web-cms",
    "/web-cms/files",
    "//host",
    "/../files",
  ])
    expect(() => loadConfig({ ...env, STATIC_PATH: path })).toThrow(
      "STATIC_PATH",
    );
  expect(() =>
    loadConfig({ ...env, STATIC_PATH: "/tools", WEB_CMS_PATH: "/tools/admin" }),
  ).toThrow("conflicts");
});

test("public files coexist with CMS, support HEAD and deny hidden, outside and write requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "mas-public-"));
  try {
    const files = join(root, "files");
    const cms = join(root, "cms");
    await mkdir(cms);
    await writeFile(join(cms, "index.html"), "cms fixture");
    for (const [environment, cmsPath] of [
      ["development", "/web-cms"],
      ["staging", "/web-cms"],
      ["production", "/"],
    ]) {
      const app = Fastify();
      try {
        const config = loadConfig({
          DATABASE_URL: "postgresql://localhost/unused_test",
          APP_ENV: environment,
          STATIC_DIR: files,
          STATIC_PATH: "/files",
          WEB_CMS_DIST: cms,
          WEB_CMS_PATH: cmsPath,
        });
        await installWebCms(app, config);
        await installPublicStatic(app, config);
        await writeFile(join(files, "example.txt"), "public example");
        await writeFile(join(files, ".secret"), "secret");
        await writeFile(join(root, "outside.txt"), "outside");
        if (environment === "development")
          await symlink(join(root, "outside.txt"), join(files, "link.txt"));
        expect((await app.inject("/files/example.txt")).body).toBe(
          "public example",
        );
        expect(
          (await app.inject({ method: "HEAD", url: "/files/example.txt" }))
            .statusCode,
        ).toBe(200);
        for (const path of [
          "/files/",
          "/files/.secret",
          "/files/%2esecret",
          "/files/link.txt",
          "/files/%2e%2e/outside.txt",
          "/files/missing.txt",
        ])
          expect((await app.inject(path)).statusCode).not.toBe(200);
        expect(
          (await app.inject({ method: "POST", url: "/files/example.txt" }))
            .statusCode,
        ).not.toBe(200);
        if (environment !== "development")
          expect(
            (await app.inject(cmsPath === "/" ? "/" : `${cmsPath}/`)).body,
          ).toBe("cms fixture");
      } finally {
        await app.close();
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
