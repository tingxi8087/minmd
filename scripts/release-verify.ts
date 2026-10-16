import { resolve } from "node:path";
import { architectures, targets } from "./release";

const root = resolve(import.meta.dir, "..");
const version = process.argv[2];
if (!version || !/^v\d+\.\d+\.\d+(?:[.-][A-Za-z0-9.-]+)?$/.test(version))
  throw new Error("需要固定版本参数");
const id = `minmd-release-test-${crypto.randomUUID().slice(0, 8)}`;
const network = `${id}-net`;
const password = crypto.randomUUID().replaceAll("-", "");
const key = "1".repeat(64);
const containers = new Set<string>();
async function command(
  args: string[],
  env: Record<string, string> = {},
  quiet = false,
) {
  const child = Bun.spawn(args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdout: quiet ? "pipe" : "inherit",
    stderr: "inherit",
    timeout: 1200000,
  });
  const [code, output] = await Promise.all([
    child.exited,
    quiet ? new Response(child.stdout).text() : Promise.resolve(""),
  ]);
  if (code) throw new Error(`发布验收失败：${args[0]} ${args[1]}（${code}）`);
  return output.trim();
}
async function wait(action: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      if (await action()) return;
    } catch {
      /* 启动期间连接可能尚未建立。 */
    }
    await Bun.sleep(500);
  }
  throw new Error(`等待超时：${label}`);
}
try {
  // 所有库、网络及容器只属于此次验收；不连接开发库，也不复用现有卷。
  await command(["docker", "network", "create", network]);
  containers.add(id);
  await command([
    "docker",
    "run",
    "-d",
    "--name",
    id,
    "--network",
    network,
    "-p",
    "127.0.0.1::5432",
    "-e",
    "POSTGRES_USER=minmd",
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-e",
    "POSTGRES_DB=minmd_release_test",
    "postgres:18",
  ]);
  await wait(async () => {
    const result = await command(
      [
        "docker",
        "exec",
        id,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "minmd",
        "-d",
        "minmd_release_test",
      ],
      {},
      true,
    );
    return result.includes("accepting connections");
  }, "PostgreSQL");
  const port = (await command(["docker", "port", id, "5432/tcp"], {}, true))
    .split(":")
    .at(-1)!;
  const db = `postgresql://minmd:${password}@127.0.0.1:${port}/minmd_release_test`;
  const testEnv = {
    DATABASE_URL: db,
    TEST_DATABASE_URL: db,
    AI_KEY_ENCRYPTION_KEY: key,
  };
  await command(["bun", "run", "db:migrate"], testEnv);
  await command(["bun", "run", "test:integration"], testEnv);
  await command(
    ["bun", "test", "tests/sheet-business-collab.test.ts"],
    testEnv,
  );
  await command(["bun", "test", "tests/runtime-process.test.ts"], {
    ...testEnv,
    RUNTIME_PROCESS_TEST: "true",
  });
  for (const arch of architectures) {
    const database = `minmd_release_${arch}_test`;
    await command(["docker", "exec", id, "createdb", "-U", "minmd", database]);
    const env = {
      APP_ENV: "production",
      HOST: "0.0.0.0",
      PORT: "9811",
      DATABASE_URL: `postgresql://minmd:${password}@${id}:5432/${database}`,
      ADMIN_PASSWORD: password,
      ADMIN_ACCOUNT: "admin",
      AUTH_TRANSPORT: "cookie",
      HTTP_IP_DIRECT: "true",
      PUBLIC_ORIGIN: "http://127.0.0.1:9811",
      APP_PUBLIC_ORIGIN: "http://127.0.0.1:9811",
      APP_DEV_ORIGINS: "",
      CORS_ORIGINS: "",
      TRUST_PROXY_ADDRESSES: "",
      AI_KEY_ENCRYPTION_KEY: key,
      STATIC_DIR: "/app/runtime/public",
      ASSET_STORAGE_DIR: "/var/lib/minmd/assets",
      WEB_CMS_PATH: "/admin",
      WEB_DIST: "/app/dist/web",
      WEB_CMS_DIST: "/app/dist/web-cms",
      LOG_LEVEL: "silent",
    };
    const args = Object.entries(env).flatMap(([name, value]) => [
      "-e",
      `${name}=${value}`,
    ]);
    const migrate = `minmd-release-migrate:${version}-${arch}`;
    for (let pass = 0; pass < 2; pass++) {
      await command([
        "docker",
        "run",
        "--rm",
        "--platform",
        `linux/${arch}`,
        "--network",
        network,
        ...args,
        migrate,
      ]);
    }
    const name = `${id}-${arch}`;
    containers.add(name);
    const image = `minmd-release-app:${version}-${arch}`;
    await command([
      "docker",
      "run",
      "-d",
      "--name",
      name,
      "--platform",
      `linux/${arch}`,
      "--network",
      network,
      "-p",
      "127.0.0.1::9811",
      ...args,
      image,
    ]);
    const appPort = (
      await command(["docker", "port", name, "9811/tcp"], {}, true)
    )
      .split(":")
      .at(-1)!;
    const base = `http://127.0.0.1:${appPort}`;
    await wait(
      async () =>
        (
          await fetch(`${base}/api/health`, {
            signal: AbortSignal.timeout(3000),
          })
        ).ok,
      `${arch} 后端`,
    );
    for (const [path, file] of [
      ["/", "dist/web/index.html"],
      ["/admin/", "dist/web-cms/index.html"],
    ]) {
      const reply = await fetch(`${base}${path}`);
      if (
        !reply.ok ||
        (await reply.text()) !== (await Bun.file(resolve(root, file!)).text())
      )
        throw new Error(`${arch} 静态页面与本机产物不一致：${path}`);
    }
    for (const target of targets) {
      const actual = await command(
        [
          "docker",
          "image",
          "inspect",
          `minmd-release-${target}:${version}-${arch}`,
          "--format",
          "{{.Os}}/{{.Architecture}}",
        ],
        {},
        true,
      );
      if (actual !== `linux/${arch}`)
        throw new Error(`镜像架构错误：${actual}`);
    }
    await command(["docker", "rm", "-f", "-v", name]);
    containers.delete(name);
    console.log(
      `${arch}：迁移重入、后端启动、前后台静态产物与镜像架构检查通过`,
    );
  }
  await command(["bun", "test", "tests/release-registry.test.ts"], {
    RELEASE_REGISTRY_TEST: "true",
    RELEASE_REGISTRY_VERSION: version,
  });
  // 三种安装模式、协作、升级、失败迁移与恢复沿用现有真实部署套件。
  const engineArchitecture = await command(
    ["docker", "info", "--format", "{{.Architecture}}"],
    {},
    true,
  );
  const native = ["aarch64", "arm64"].includes(engineArchitecture)
    ? "arm64"
    : "amd64";
  await command(["bun", "test", "tests/deploy-runtime.test.ts"], {
    DEPLOY_RUNTIME_TEST: "true",
    DEPLOY_RUNTIME_TLS_ONLY: "false",
    DEPLOY_RUNTIME_IMAGE_FALLBACK: "false",
    DEPLOY_APP_IMAGE: `minmd-release-app:${version}-${native}`,
    DEPLOY_MIGRATE_IMAGE: `minmd-release-migrate:${version}-${native}`,
  });
} finally {
  for (const container of containers) {
    try {
      await command(["docker", "rm", "-f", "-v", container], {}, true);
    } catch {
      /* 继续清理本次其他资源。 */
    }
  }
  try {
    await command(["docker", "network", "rm", network], {}, true);
  } catch {
    /* 不操作其他网络。 */
  }
}
