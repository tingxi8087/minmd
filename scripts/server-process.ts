import { appConfig } from "../app.config";

/** 开发与验收共用入口，只有开发模式启用文件监听。 */
export function startServer(watch = false) {
  return Bun.spawn(
    [process.execPath, ...(watch ? ["--watch"] : []), appConfig.serverEntry],
    { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
  );
}

if (import.meta.main) {
  const child = startServer(process.argv.includes("--watch"));
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.exitCode = await child.exited;
}
