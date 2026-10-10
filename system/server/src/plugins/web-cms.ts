import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { AppConfig } from "../config/env";

/** 按部署配置挂载控制台静态产物；不依赖前端源码。 */
export async function installWebCms(app: FastifyInstance, config: AppConfig) {
  if (config.APP_ENV === "development") return;
  const root = resolve(config.WEB_CMS_DIST);
  if (!existsSync(resolve(root, "index.html")))
    throw new Error("Web CMS build missing: run bun run build first");
  const prefix = config.WEB_CMS_PATH === "/" ? "/" : `${config.WEB_CMS_PATH}/`;
  await app.register(fastifyStatic, { root, prefix });
  if (prefix !== "/") {
    app.get(config.WEB_CMS_PATH, async (_, reply) => reply.redirect(prefix));
  }
}
