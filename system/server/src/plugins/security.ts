import type { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { AppConfig } from "../config/env";
export async function installSecurity(app: FastifyInstance, config: AppConfig) {
  await app.register(cookie);
  await app.register(cors, {
    origin: config.CORS_ORIGINS.length ? config.CORS_ORIGINS : false,
    credentials: config.AUTH_TRANSPORT === "cookie",
    allowedHeaders: ["content-type", "authorization", "x-csrf-token"],
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        upgradeInsecureRequests: config.APP_ENV === "production" ? [] : null,
      },
    },
    strictTransportSecurity: config.APP_ENV === "production",
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    errorResponseBuilder: (request) => ({
      statusCode: 429,
      code: "RATE_LIMITED",
      message: "请求过于频繁，请稍后重试",
      requestId: request.id,
    }),
  });
}
