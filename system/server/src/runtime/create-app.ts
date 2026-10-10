import {
  validateCatalog,
  type PermissionCatalog,
  type RoleMembership,
} from "../modules/permissions/registry";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import { createDatabase, type Database } from "../database/client";
import { loadConfig, type AppConfig } from "../config/env";
import { systemPlugin } from "../system";
import { installWebCms } from "../plugins/web-cms";
import { installPublicStatic } from "../plugins/public-static";

export interface AppContext {
  config: AppConfig;
  database: Database;
}
export interface CreateAppOptions {
  permissions: PermissionCatalog;
  appRoleMembership?: RoleMembership;
  config?: AppConfig;
  options?: FastifyServerOptions;
  /** 系统模块就绪后注册业务；不要在此监听端口或创建第二份数据库连接。 */
  register?: (
    app: FastifyInstance,
    context: AppContext,
  ) => void | Promise<void>;
}
/** 创建应用但不监听端口；调用者可以 inject 测试，使用后调用 app.close()。 */
export async function createApp({
  config = loadConfig(),
  options = {},
  register,
  permissions,
  appRoleMembership,
}: CreateAppOptions) {
  validateCatalog(permissions);
  const { logger, ...serverOptions } = options;
  const app = Fastify({
    logger:
      logger === false
        ? false
        : {
            ...(typeof logger === "object" ? logger : {}),
            level: config.LOG_LEVEL,
            base: { environment: config.APP_ENV, service: "mas-backend" },
            redact: [
              "req.headers.authorization",
              "req.headers.cookie",
              "res.headers.set-cookie",
              "password",
              "token",
              "DATABASE_URL",
            ],
            serializers: {
              req: (req) => ({
                method: req.method,
                url: req.url?.split("?")[0],
                hostname: req.hostname,
              }),
            },
          },
    requestIdHeader: false,
    genReqId: () => crypto.randomUUID(),
    ajv: { customOptions: { removeAdditional: false, keywords: ["example"] } },
    ...serverOptions,
  });
  const database = createDatabase(config.DATABASE_URL);
  // The factory owns this connection. Both boot failure and normal close use
  // the same promise, so the pool is ended exactly once.
  let closingDatabase: Promise<void> | undefined;
  const closeDatabase = () => (closingDatabase ??= database.close());
  app.addHook("onClose", closeDatabase);
  try {
    await app.register(systemPlugin, {
      config,
      database,
      permissions,
      appRoleMembership,
    });
    await register?.(app, { config, database });
    await installWebCms(app, config);
    await installPublicStatic(app, config);
    return app;
  } catch (error) {
    await app.close().catch(() => {});
    await closeDatabase().catch(() => {});
    throw error;
  }
}
