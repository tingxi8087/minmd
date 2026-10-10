import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { mkdir } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AppConfig } from "../config/env";

/** 各环境公开读取静态文件；不提供上传、目录列表或目录外文件访问。 */
export async function installPublicStatic(
  app: FastifyInstance,
  config: AppConfig,
) {
  await mkdir(resolve(config.STATIC_DIR), { recursive: true });
  const root = realpathSync(resolve(config.STATIC_DIR));
  await app.register(fastifyStatic, {
    root,
    prefix: `${config.STATIC_PATH}/`,
    decorateReply: false,
    dotfiles: "deny",
    index: false,
    list: false,
    allowedPath: (pathname) => {
      try {
        // 同时检查实际目标，阻止符号链接绕过静态目录和隐藏文件限制。
        const target = relative(
          root,
          realpathSync(
            resolve(root, `.${pathname.startsWith("/") ? "" : "/"}${pathname}`),
          ),
        );
        return (
          !isAbsolute(target) &&
          target.split(sep).every((part) => !part.startsWith("."))
        );
      } catch {
        return false;
      }
    },
  });
}
