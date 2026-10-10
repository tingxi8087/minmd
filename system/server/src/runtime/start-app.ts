import type { FastifyInstance } from "fastify";
import { loadConfig, type AppConfig } from "../config/env";
import { initializeSuperAdmin } from "../modules/auth/bootstrap";
import { startupErrorMessage } from "./startup-error";

export type AppBuilder = (config: AppConfig) => Promise<FastifyInstance>;
/** CLI 启动入口：只在调用时监听端口和安装退出处理；导入本身没有进程副作用。 */
export async function startApp(buildApp: AppBuilder) {
  let app: FastifyInstance | undefined;
  try {
    const config = loadConfig();
    app = await buildApp(config);
    await initializeSuperAdmin(config);
    const server = app;
    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      const timeout = setTimeout(() => process.exit(1), 10000);
      timeout.unref();
      let exitCode = 0;
      try {
        await server.close();
      } catch {
        console.error("Server shutdown failed; check server logs.");
        exitCode = 1;
      } finally {
        clearTimeout(timeout);
        process.exit(exitCode);
      }
    };
    const onSignal = () => {
      void shutdown();
    };
    // Normal programmatic close or a failed listen also removes these handlers.
    server.addHook("onClose", async () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    });
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    await server.listen({ host: config.HOST, port: config.PORT });
    return server;
  } catch (error) {
    await app?.close().catch(() => {});
    console.error(startupErrorMessage(error));
    process.exitCode = 1;
    return undefined;
  }
}
