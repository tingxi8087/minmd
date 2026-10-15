import { rootCertificates } from "node:tls";
import { expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  cp,
  readFile,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
const runtimeTest =
  process.env.DEPLOY_RUNTIME_TEST === "true" ? test : test.skip;
const source = join(import.meta.dir, "..");
const tlsOnly = process.env.DEPLOY_RUNTIME_TLS_ONLY === "true";
const fallbackImages = process.env.DEPLOY_RUNTIME_IMAGE_FALLBACK === "true";
const wait = async (check: () => boolean | Promise<boolean>, label: string) => {
  const end = Date.now() + 20000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`等待超时：${label}`);
    await Bun.sleep(100);
  }
};
const redact = (value: string) =>
  value.replace(/[a-f0-9]{64}/g, "<generated-secret>");
async function command(args: string[], cwd?: string) {
  const p = Bun.spawn(args, {
    cwd,
    env: {
      ...process.env,
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
      http_proxy: "",
      https_proxy: "",
      all_proxy: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { code, out, err };
}
async function must(args: string[], cwd?: string) {
  const result = await command(args, cwd);
  if (result.code)
    throw new Error(redact(`${args[0]} 失败：${result.err}\n${result.out}`));
  return result.out.trim();
}
interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
  raw: string;
}
function api(port: number, origin: string, ca?: string) {
  return (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Promise<Reply>((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const request = ca ? httpsRequest : httpRequest;
      const req = request(
        {
          hostname: "127.0.0.1",
          agent: false,
          port,
          path,
          method,
          ca,
          rejectUnauthorized: true,
          servername: new URL(origin).hostname,
          headers: {
            host: new URL(origin).host,
            connection: "close",
            origin,
            ...(payload
              ? {
                  "content-type": "application/json",
                  "content-length": String(Buffer.byteLength(payload)),
                }
              : {}),
            ...headers,
          },
        },
        (response) => {
          let raw = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            raw += chunk;
          });
          response.on("end", () => {
            let parsed: Record<string, unknown> = {};
            try {
              parsed = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              /* 静态 HTML 不解析为 JSON。 */
            }
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              raw,
              body: parsed,
            });
          });
        },
      );
      req.on("error", reject);
      req.setTimeout(15000, () => req.destroy(new Error("请求超时")));
      req.end(payload);
    });
}
runtimeTest(
  tlsOnly
    ? "真实自动 HTTPS：证书校验、登录、双端协作与重启"
    : "真实安装器：三种模式、配置复用、TLS/协作、固定版本升级、迁移失败和备份恢复",
  async () => {
    const appImage = process.env.DEPLOY_APP_IMAGE,
      migrateImage = process.env.DEPLOY_MIGRATE_IMAGE;
    if (!appImage || !migrateImage)
      throw new Error(
        "请提供 DEPLOY_APP_IMAGE 和 DEPLOY_MIGRATE_IMAGE，使用本次构建的测试镜像",
      );
    const dir = await mkdtemp(join(tmpdir(), "minmd-deploy-real-"));
    const suffix = crypto.randomUUID().slice(0, 8),
      prefix = `minmd-runtime-${suffix}`;
    const projects = [
      `minmd-runtime-proxy-${suffix}`,
      `minmd-runtime-https-${suffix}`,
      `minmd-runtime-direct-${suffix}`,
    ];
    const bundle = join(dir, "bundle");
    await mkdir(join(bundle, "deploy/scripts"), { recursive: true });
    for (const name of ["minmd.sh"])
      await cp(join(source, name), join(bundle, name));
    for (const name of [
      "compose.production.yaml",
      "compose.proxy.yaml",
      "compose.https.yaml",
      "compose.direct.yaml",
      "Caddyfile",
    ])
      await cp(join(source, "deploy", name), join(bundle, "deploy", name));
    for (const name of ["manage.sh", "compose.sh", "backup.sh", "restore.sh"])
      await cp(
        join(source, "deploy/scripts", name),
        join(bundle, "deploy/scripts", name),
      );
    // 仅测试证书签发使用本地 CA。保留生产的 HTTPS、反代、80/443 及所有证书验证。
    const caddy = await readFile(join(bundle, "deploy/Caddyfile"), "utf8");
    await writeFile(
      join(bundle, "deploy/Caddyfile"),
      caddy.replace("{$MINMD_SITE} {", "{$MINMD_SITE} {\n\ttls internal"),
    );
    const reservation = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("reserved"),
    });
    const port = reservation.port!;
    await reservation.stop(true);
    const images: string[] = [];
    const cli = (data: string, args: string[]) =>
      command(["sh", join(bundle, "minmd.sh"), ...args, "--dir", data]);
    const run = async (data: string, args: string[]) => {
      const r = await cli(data, args);
      if (r.code) throw new Error(redact(`${args[0]}：${r.err}\n${r.out}`));
      return r;
    };
    const cfg = async (data: string) =>
      Object.fromEntries(
        (await readFile(join(data, ".env"), "utf8"))
          .trim()
          .split("\n")
          .map((line) => [
            line.slice(0, line.indexOf("=")),
            line.slice(line.indexOf("=") + 1),
          ]),
      );
    const compose = async (data: string, args: string[]) => {
      const env = await cfg(data);
      return must([
        "docker",
        "compose",
        "--env-file",
        join(data, ".env"),
        "-f",
        join(bundle, "deploy/compose.production.yaml"),
        "-f",
        join(bundle, `deploy/compose.${env.MINMD_DEPLOY_MODE}.yaml`),
        ...args,
      ]);
    };
    try {
      for (const image of ["postgres:18", "caddy:2.11.4-alpine"]) {
        if ((await command(["docker", "image", "inspect", image])).code)
          await must(["docker", "pull", image]);
      }
      if (fallbackImages) {
        const metadata: string[] = [];
        for (const [target, tag] of [
          ["postgres", "18"],
          ["caddy", "2.11.4-alpine"],
        ]) {
          const primary = `${prefix}-${target}-primary:${tag}`;
          const backup = `${prefix}-${target}-backup:${tag}`;
          await must(["docker", "tag", `${target}:${tag}`, backup]);
          images.push(backup);
          metadata.push(
            `${target!.toUpperCase()}_IMAGE=${primary}`,
            `${target!.toUpperCase()}_IMAGE_FALLBACK=${backup}`,
          );
        }
        await writeFile(
          join(bundle, "deploy/release.env"),
          metadata.join("\n") + "\n",
        );
      }
      for (const version of ["v0.0.1", "v0.0.2", "v0.0.3"]) {
        for (const [target, original] of [
          ["app", appImage],
          ["migrate", migrateImage],
        ] as const) {
          const image = `${prefix}-${target}:${version}`;
          await must(["docker", "tag", original, image]);
          images.push(image);
        }
      }
      const failDir = join(dir, "failed-migration");
      await mkdir(failDir);
      await writeFile(
        join(failDir, "Dockerfile"),
        `FROM ${migrateImage}\nCMD ["sh", "-c", "exit 23"]\n`,
      );
      await must([
        "docker",
        "build",
        "-t",
        `${prefix}-migrate:v0.0.3`,
        failDir,
      ]);
      if (!tlsOnly) {
        console.info("部署验收：已有反代模式首次安装与冲突检测");
        const proxy = join(dir, "proxy data");
        const origin = "https://runtime.example.test";
        await run(proxy, [
          "install",
          "--mode",
          "proxy",
          "--origin",
          origin,
          "--port",
          String(port),
          "--project",
          projects[0]!,
          "--image-prefix",
          prefix,
          "--version",
          "v0.0.1",
          "--offline",
          "--yes",
        ]);
        const initial = await readFile(join(proxy, ".env"), "utf8");
        await run(proxy, ["install", "--offline", "--yes"]);
        expect(await readFile(join(proxy, ".env"), "utf8")).toBe(initial);
        // 第二实例同端口必须失败且不留下安装配置；不能误接管原项目。
        const conflictDir = join(dir, "conflict");
        expect(
          (
            await cli(conflictDir, [
              "install",
              "--mode",
              "proxy",
              "--origin",
              origin,
              "--port",
              String(port),
              "--project",
              `conflict-${suffix}`,
              "--image-prefix",
              prefix,
              "--version",
              "v0.0.1",
              "--offline",
              "--yes",
            ])
          ).code,
        ).not.toBe(0);
        expect(await Bun.file(join(conflictDir, ".env")).exists()).toBe(false);
        const request = api(port, origin);
        const home = await request("/");
        expect(home.status).toBe(200);
        expect(home.raw).toContain('id="root"');
        expect((await request("/admin/")).raw).toContain('id="root"');
        expect((await request("/assets/missing.js")).status).toBe(404);
        const setup = await request("/api/app/auth/setup", "POST", {
          account: "runtime_user",
          password: "Runtime123456",
          spaceName: "运行验收空间",
        });
        expect(setup.status).toBe(200);
        expect(setup.headers["set-cookie"]?.join(";")).toContain("Secure");
        const cookie = setup.headers["set-cookie"]!.map(
          (v) => v.split(";")[0],
        ).join("; ");
        const headers = {
          cookie,
          "x-csrf-token": String(setup.body.csrfToken),
        };
        const documentId = String(setup.body.documentId);
        const rename = async (name: string) => {
          const current = await request(
            `/api/app/files/${documentId}`,
            "GET",
            undefined,
            headers,
          );
          expect(current.status).toBe(200);
          const r = await request(
            `/api/app/files/${documentId}`,
            "PATCH",
            { name, expectedMetadataRevision: current.body.metadataRevision },
            headers,
          );
          expect(r.status).toBe(200);
        };
        await rename("备份前内容");
        const appId = await compose(proxy, ["ps", "-q", "app"]);
        await must([
          "docker",
          "exec",
          appId,
          "bun",
          "-e",
          'await Bun.write("/var/lib/minmd/assets/runtime-marker.bin",new Uint8Array([0,1,2,128,255]))',
        ]);
        console.info("部署验收：一致备份、升级、迁移失败与恢复");
        const backup = join(dir, "backup");
        await run(proxy, ["backup", backup]);
        await rename("备份后修改");
        await must([
          "docker",
          "exec",
          appId,
          "bun",
          "-e",
          'await Bun.write("/var/lib/minmd/assets/runtime-marker.bin","changed")',
        ]);
        await run(proxy, ["upgrade", "v0.0.2", "--offline"]);
        expect((await cfg(proxy)).MINMD_IMAGE_TAG).toBe("v0.0.2");
        expect(
          (
            await request(
              `/api/app/files/${documentId}`,
              "GET",
              undefined,
              headers,
            )
          ).body.name,
        ).toBe("备份后修改");
        expect(
          (await cli(proxy, ["upgrade", "v0.0.3", "--offline"])).code,
        ).not.toBe(0);
        expect(await Bun.file(join(proxy, ".maintenance")).exists()).toBe(true);
        expect(await compose(proxy, ["ps", "-q", "app"])).toBe("");
        expect((await cli(proxy, ["start", "--offline"])).code).not.toBe(0);
        const backupCount = (await readdir(join(proxy, "backups"))).length;
        expect(
          (await cli(proxy, ["upgrade", "v0.0.3", "--offline"])).code,
        ).not.toBe(0);
        expect((await readdir(join(proxy, "backups"))).length).toBe(
          backupCount,
        );
        await run(proxy, ["restore", backup, "--offline", "--yes"]);
        expect((await cfg(proxy)).MINMD_IMAGE_TAG).toBe("v0.0.1");
        expect(await compose(proxy, ["ps", "-q", "app"])).toBe("");
        await run(proxy, ["start", "--offline"]);
        expect(
          (
            await request(
              `/api/app/files/${documentId}`,
              "GET",
              undefined,
              headers,
            )
          ).body.name,
        ).toBe("备份前内容");
        const restoredApp = await compose(proxy, ["ps", "-q", "app"]);
        expect(
          await must([
            "docker",
            "exec",
            restoredApp,
            "bun",
            "-e",
            'console.log(JSON.stringify([...new Uint8Array(await Bun.file("/var/lib/minmd/assets/runtime-marker.bin").arrayBuffer())]))',
          ]),
        ).toBe("[0,1,2,128,255]");
        await run(proxy, ["stop"]);
      }
      console.info("部署验收：自动 HTTPS、证书验证和双端协作");
      if (!tlsOnly) {
        console.info("部署验收：HTTP IP 直连、前后台登录、CSRF 和双端 WS 协作");
        const direct = join(dir, "direct data"),
          origin = `http://127.0.0.1:${port}`;
        await run(direct, [
          "install",
          "--mode",
          "direct",
          "--origin",
          origin,
          "--project",
          projects[2]!,
          "--image-prefix",
          prefix,
          "--version",
          "v0.0.1",
          "--offline",
          "--yes",
        ]);
        const env = await cfg(direct);
        expect(env.APP_BIND_HOST).toBe("0.0.0.0");
        expect(env.TRUST_PROXY_ADDRESSES).toBe("");
        const request = api(port, origin);
        for (const path of ["/", "/admin/"]) {
          const page = await request(path);
          expect(page.raw).toContain('id="root"');
          expect(page.headers["strict-transport-security"]).toBeUndefined();
          expect(page.headers["content-security-policy"]).not.toContain(
            "upgrade-insecure-requests",
          );
        }
        const setup = await request("/api/app/auth/setup", "POST", {
          account: "direct_user",
          password: "Direct123456",
          spaceName: "IP 直连协作",
        });
        expect(setup.status).toBe(200);
        expect(setup.headers["set-cookie"]?.join(";")).toContain("HttpOnly");
        expect(setup.headers["set-cookie"]?.join(";")).not.toMatch(
          /;\s*Secure/i,
        );
        const cookie = setup.headers["set-cookie"]!.map(
          (v) => v.split(";")[0],
        ).join("; ");
        const headers = {
            cookie,
            "x-csrf-token": String(setup.body.csrfToken),
          },
          fileId = String(setup.body.documentId);
        expect(
          (
            await request(
              "/api/app/spaces",
              "POST",
              { name: "应拒绝" },
              { cookie },
            )
          ).status,
        ).toBe(403);
        expect(
          (
            await request(
              "/api/app/spaces",
              "POST",
              { name: "应拒绝" },
              { ...headers, origin: "http://192.0.2.1:9811" },
            )
          ).status,
        ).toBe(403);
        const admin = await request("/api/auth/login", "POST", {
          account: "admin",
          password: env.ADMIN_PASSWORD,
        });
        expect(admin.status).toBe(200);
        expect(admin.headers["set-cookie"]?.join(";")).not.toMatch(
          /;\s*Secure/i,
        );
        const tickets: string[] = [];
        for (let i = 0; i < 2; i++) {
          const ticket = await request(
            `/api/app/files/${fileId}/collaboration-ticket`,
            "POST",
            { schemaVersion: 1 },
            headers,
          );
          expect(ticket.status).toBe(200);
          tickets.push(String(ticket.body.ticket));
        }
        const probeFile = join(dir, "direct-probe.json"),
          snapshotPath = join(dir, "direct-snapshot.json");
        await writeFile(
          probeFile,
          JSON.stringify({
            origin,
            domain: "127.0.0.1",
            fileId,
            tickets,
            snapshotPath,
          }),
          { mode: 0o600 },
        );
        const child = Bun.spawn(
          ["node", join(source, "tests/fixtures/deploy-tls-client.cjs")],
          {
            env: {
              ...process.env,
              MINMD_SOURCE_ROOT: source,
              MINMD_TLS_PROBE_FILE: probeFile,
              HTTP_PROXY: "",
              HTTPS_PROXY: "",
              ALL_PROXY: "",
            },
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        const [code, out, err] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        if (code) throw new Error(`HTTP 协作验收失败：${err}`);
        expect(out).toContain("HTTP IP 直连、双端协作认证及编辑广播通过");
        expect(
          (
            await request(
              `/api/app/files/${fileId}/checkpoint`,
              "POST",
              {
                snapshot: JSON.parse(
                  await readFile(snapshotPath, "utf8"),
                ) as number[],
                manual: true,
              },
              headers,
            )
          ).status,
        ).toBe(200);
        await run(direct, ["restart", "--offline"]);
        expect(
          (
            await request(
              `/api/app/files/${fileId}/content`,
              "GET",
              undefined,
              headers,
            )
          ).raw,
        ).toContain("HTTP双端同步");
        expect((await cli(direct, ["doctor"])).code).toBe(0);
        await run(direct, ["stop"]);
      }
      const tls = join(dir, "https data");
      const domain = `minmd-${suffix}.test`,
        tlsOrigin = `https://${domain}`;
      await run(tls, [
        "install",
        "--mode",
        "https",
        "--origin",
        tlsOrigin,
        "--project",
        projects[1]!,
        "--image-prefix",
        prefix,
        "--version",
        "v0.0.1",
        "--offline",
        "--yes",
      ]);
      const tlsApp = await compose(tls, ["ps", "-q", "app"]),
        caddyId = await compose(tls, ["ps", "-q", "caddy"]);
      expect(
        await must([
          "docker",
          "inspect",
          "--format",
          "{{json .HostConfig.PortBindings}}",
          tlsApp,
        ]),
      ).toMatch(/^null$|^\{\}$/);
      const caddyPorts = JSON.parse(
        await must([
          "docker",
          "inspect",
          "--format",
          "{{json .HostConfig.PortBindings}}",
          caddyId,
        ]),
      ) as Record<string, unknown>;
      expect(Object.keys(caddyPorts).sort()).toEqual(["443/tcp", "80/tcp"]);
      await wait(
        async () =>
          (
            await command([
              "docker",
              "exec",
              caddyId,
              "test",
              "-f",
              "/data/caddy/pki/authorities/local/root.crt",
            ])
          ).code === 0,
        "测试 CA 创建",
      );
      const caFile = join(dir, "root.crt");
      await must([
        "docker",
        "cp",
        `${caddyId}:/data/caddy/pki/authorities/local/root.crt`,
        caFile,
      ]);
      const ca = await readFile(caFile, "utf8"),
        tlsRequest = api(443, tlsOrigin, ca);
      await wait(async () => {
        try {
          return (await tlsRequest("/api/health")).status === 200;
        } catch {
          return false;
        }
      }, "HTTPS 证书及应用就绪");
      await expect(
        api(443, tlsOrigin, rootCertificates[0]!)("/api/health"),
      ).rejects.toBeInstanceOf(Error);
      expect((await tlsRequest("/")).raw).toContain('id="root"');
      expect((await tlsRequest("/admin/")).raw).toContain('id="root"');
      expect(
        (
          await tlsRequest(
            "/mcp",
            "POST",
            { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
            { accept: "application/json, text/event-stream" },
          )
        ).status,
      ).toBe(401);
      const tlsSetup = await tlsRequest("/api/app/auth/setup", "POST", {
        account: "tls_user",
        password: "Runtime123456",
        spaceName: "TLS 协作验收",
      });
      expect(tlsSetup.status).toBe(200);
      const tlsCookie = tlsSetup.headers["set-cookie"]!.map(
        (v) => v.split(";")[0],
      ).join("; ");
      const tlsHeaders = {
          cookie: tlsCookie,
          "x-csrf-token": String(tlsSetup.body.csrfToken),
        },
        fileId = String(tlsSetup.body.documentId);
      const tickets: string[] = [];
      for (let i = 0; i < 2; i++) {
        const ticket = await tlsRequest(
          `/api/app/files/${fileId}/collaboration-ticket`,
          "POST",
          { schemaVersion: 1 },
          tlsHeaders,
        );
        expect(ticket.status).toBe(200);
        tickets.push(String(ticket.body.ticket));
      }
      const probeFile = join(dir, "tls-probe.json"),
        snapshotPath = join(dir, "snapshot.json");
      await writeFile(
        probeFile,
        JSON.stringify({ domain, fileId, ca, tickets, snapshotPath }),
        { mode: 0o600 },
      );
      const probe = Bun.spawn(
        ["node", join(source, "tests/fixtures/deploy-tls-client.cjs")],
        {
          env: {
            ...process.env,
            MINMD_SOURCE_ROOT: source,
            MINMD_TLS_PROBE_FILE: probeFile,
            HTTP_PROXY: "",
            HTTPS_PROXY: "",
            ALL_PROXY: "",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [probeCode, probeOut, probeError] = await Promise.all([
        probe.exited,
        new Response(probe.stdout).text(),
        new Response(probe.stderr).text(),
      ]);
      if (probeCode) throw new Error(`TLS 客户端验收失败：${probeError}`);
      expect(probeOut).toContain("双端协作认证及编辑广播通过");
      const checkpoint = await tlsRequest(
        `/api/app/files/${fileId}/checkpoint`,
        "POST",
        {
          snapshot: JSON.parse(
            await readFile(snapshotPath, "utf8"),
          ) as number[],
          manual: true,
        },
        tlsHeaders,
      );
      expect(checkpoint.status).toBe(200);
      if (fallbackImages) {
        const selected = await cfg(tls);
        expect(selected.POSTGRES_IMAGE).toBe(`${prefix}-postgres-backup:18`);
        expect(selected.CADDY_IMAGE).toBe(
          `${prefix}-caddy-backup:2.11.4-alpine`,
        );
      }
      const originalKey = (await cfg(tls)).AI_KEY_ENCRYPTION_KEY;
      await run(tls, ["restart", "--offline"]);
      expect((await cfg(tls)).AI_KEY_ENCRYPTION_KEY).toBe(originalKey);
      expect((await tlsRequest("/api/health")).status).toBe(200);
      expect((await cli(tls, ["doctor"])).code).not.toBe(0); // .test 域名未配置公网 DNS，不能误报公网入口就绪。
      await compose(tls, ["stop", "app"]);
      expect(
        (await tlsRequest("/?share_token=minmd-private-uri-probe")).status,
      ).toBe(502);
      expect(await must(["docker", "logs", caddyId])).not.toContain(
        "minmd-private-uri-probe",
      );
      await run(tls, ["stop"]);
    } finally {
      for (let i = 0; i < projects.length; i++) {
        const data = join(
          dir,
          i === 0 ? "proxy data" : i === 1 ? "https data" : "direct data",
        );
        if (await Bun.file(join(data, ".env")).exists()) {
          await command([
            "docker",
            "compose",
            "--env-file",
            join(data, ".env"),
            "-f",
            join(bundle, "deploy/compose.production.yaml"),
            "-f",
            join(
              bundle,
              `deploy/compose.${i === 0 ? "proxy" : i === 1 ? "https" : "direct"}.yaml`,
            ),
            "down",
            "-v",
            "--remove-orphans",
          ]);
        }
      }
      for (const image of images)
        await command(["docker", "image", "rm", image]);
      await rm(dir, { recursive: true, force: true });
    }
  },
  900000,
);
