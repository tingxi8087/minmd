import type { FastifyInstance } from "fastify";
import type { Database } from "../../../../../system/server/src/database/client";
import { AppError } from "../../../../../system/server/src/errors";
import { authorizeAi } from "./service";

/** 仅保存已验证密钥的ID与计数，HTTP和MCP共享额度，失效凭证不分配内存。 */
export function registerAiRateLimit(
  app: FastifyInstance,
  database: Database,
  max: number,
) {
  const windows = new Map<string, { count: number; expiresAt: number }>();
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?", 1)[0] ?? "";
    if (
      !path.startsWith("/api/v1/") &&
      !(path === "/mcp" && request.method === "POST")
    )
      return;
    const bearer = request.headers.authorization;
    if (!bearer?.startsWith("Bearer ")) return;
    const identity = await authorizeAi(database.db, bearer.slice(7));
    const now = Date.now();
    // 清理只发生于调用，不创建额外后台计时器或长期保留撤销密钥的计数。
    for (const [id, window] of windows) {
      if (window.expiresAt <= now) windows.delete(id);
    }
    let window = windows.get(identity.keyId);
    if (!window) {
      window = { count: 0, expiresAt: now + 60_000 };
      windows.set(identity.keyId, window);
    }
    if (window.count >= max) {
      reply.header(
        "retry-after",
        Math.max(1, Math.ceil((window.expiresAt - now) / 1000)),
      );
      throw new AppError(
        "AI_RATE_LIMITED",
        "AI密钥请求过于频繁，请稍后重试",
        429,
      );
    }
    window.count++;
  });
  app.addHook("onClose", async () => {
    windows.clear();
  });
}
