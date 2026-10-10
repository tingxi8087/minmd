import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 直接运行 Vite 入口，让统一开发进程可以关闭所有子服务。 */
export function startVite(app: "web" | "web-cms") {
  const cwd = fileURLToPath(new URL(`../apps/${app}/`, import.meta.url));
  const require = createRequire(join(cwd, "package.json"));
  const entry = join(
    dirname(require.resolve("vite/package.json")),
    "bin/vite.js",
  );
  const noProxy = [
    process.env.NO_PROXY,
    process.env.no_proxy,
    "localhost",
    "127.0.0.1",
    "::1",
  ]
    .filter(Boolean)
    .join(",");
  return Bun.spawn([process.execPath, entry, "--host", "127.0.0.1"], {
    cwd,
    env: { ...process.env, NO_PROXY: noProxy, no_proxy: noProxy },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
}
