import type { FastifyInstance } from "fastify";
import proxy from "@fastify/http-proxy";
import type { AppConfig } from "@mas/system-server";
import { loadDevConfig } from "../../../../../config/dev";
import { AppError } from "../../../../../system/server/src/errors";

/** 开发网页共用后端来源；API 与协作路由不经过网页代理。 */
export async function registerDevWeb(app: FastifyInstance, config: AppConfig) {
  if (config.APP_ENV !== "development") return;
  const dev = loadDevConfig({ ...process.env, PORT: String(config.PORT) });
  if (!dev.enabled) return;
  if (
    config.WEB_CMS_PATH === "/" ||
    /^\/(?:mcp|assets)(?:\/|$)/.test(config.WEB_CMS_PATH)
  )
    throw new Error("开发双网页代理需要独立的 WEB_CMS_PATH，例如 /admin");
  await app.register(async (pages) => {
    pages.addHook("onSend", async (_request, reply, payload) => {
      // Vite 的 React 初始化包含内联脚本；仅开发网页放宽 CSP，API 保持原有安全头。
      reply.removeHeader("content-security-policy");
      return payload;
    });
    const options = {
      // 使用 Node HTTP 客户端，兼容 Bun 的运行时实现。
      http: {},
      httpMethods: ["GET", "HEAD"],
      config: { auth: false, rateLimit: false },
      internalRewriteLocationHeader: false,
    };
    pages.get(config.WEB_CMS_PATH, async (_, reply) =>
      reply.redirect(`${config.WEB_CMS_PATH}/`),
    );
    await pages.register(proxy, {
      ...options,
      upstream: `http://127.0.0.1:${dev.cmsPort}`,
      prefix: config.WEB_CMS_PATH,
      rewritePrefix: config.WEB_CMS_PATH,
      routes: ["/*"],
    });
    await pages.register(proxy, {
      ...options,
      upstream: `http://127.0.0.1:${dev.webPort}`,
      preHandler: (request, _reply, done) => {
        // 未注册的接口必须返回 404，避免被 Vite 的 API 代理送回本服务形成循环。
        const pathname = new URL(request.raw.url!, "http://localhost").pathname;
        if (/^\/(?:api|mcp)(?:\/|$)/.test(pathname))
          return done(new AppError("NOT_FOUND", "接口不存在", 404));
        done();
      },
    });
  });
}
