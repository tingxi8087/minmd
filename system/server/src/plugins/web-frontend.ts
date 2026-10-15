import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AppConfig } from "../config/env";

/** 托管 Hash Router 前台；其他业务路由不使用 HTML 回退。 */
export async function installWebFrontend(
  app: FastifyInstance,
  config: AppConfig,
) {
  if (config.APP_ENV === "development") return;
  if (
    config.WEB_CMS_PATH === "/" ||
    /^\/(?:assets|mcp)(?:\/|$)/.test(config.WEB_CMS_PATH) ||
    /^\/assets(?:\/|$)/.test(config.STATIC_PATH)
  )
    throw new Error(
      "前后台同时托管需要独立的 WEB_CMS_PATH / STATIC_PATH，不能占用 /、/assets 或 /mcp",
    );
  const directory = resolve(config.WEB_DIST);
  if (!existsSync(resolve(directory, "index.html")))
    throw new Error("Web frontend build missing: run bun run build first");
  const root = realpathSync(directory);
  const wsOrigin = new URL(config.PUBLIC_ORIGIN);
  wsOrigin.protocol = wsOrigin.protocol === "https:" ? "wss:" : "ws:";
  // FortuneSheet 公式引擎需要动态求值，PPT 图片使用 Blob；仅前台 HTML 使用此策略，API 和后台沿用原策略。
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${wsOrigin.origin}`,
    "media-src 'self' blob: data:",
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    ...(config.APP_ENV === "production" && !config.HTTP_IP_DIRECT
      ? ["upgrade-insecure-requests"]
      : []),
  ].join("; ");
  await app.register(async (pages) => {
    pages.addHook("onRoute", (route) => {
      route.config = { ...route.config, auth: false, rateLimit: false };
    });
    pages.addHook("onSend", async (request, reply, payload) => {
      if (reply.statusCode >= 200 && reply.statusCode < 400) {
        const html = String(reply.getHeader("content-type")).startsWith(
          "text/html",
        );
        if (html) reply.header("Content-Security-Policy", csp);
        reply.header(
          "Cache-Control",
          html
            ? "no-store"
            : request.url.split("?")[0]?.startsWith("/assets/")
              ? "public, max-age=31536000, immutable"
              : "public, max-age=3600",
        );
      }
      return payload;
    });
    await pages.register(fastifyStatic, {
      root,
      prefix: "/",
      decorateReply: false,
      dotfiles: "deny",
      list: false,
      schemaHide: true,
      allowedPath: (pathname) => {
        const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
        const reserved = [
          "/api",
          "/mcp",
          config.WEB_CMS_PATH,
          config.STATIC_PATH,
        ];
        if (
          reserved.some(
            (prefix) => path === prefix || path.startsWith(`${prefix}/`),
          )
        )
          return false;
        try {
          const target = relative(
            root,
            realpathSync(resolve(root, `.${path}`)),
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
  });
}
