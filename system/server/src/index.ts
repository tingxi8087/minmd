// Public entrypoint: implementations import their direct dependencies, not this barrel.
export {
  createApp,
  type CreateAppOptions,
  type AppContext,
} from "./runtime/create-app";
export { startApp, type AppBuilder } from "./runtime/start-app";
export { startupErrorMessage } from "./runtime/startup-error";
export { systemPlugin, errorSchema } from "./system";
export { loadConfig, type AppConfig } from "./config/env";
export type { FastifyServerOptions as AppOptions } from "fastify";

export type {
  PermissionCatalog,
  PermissionGroup,
  RoleScope,
} from "./modules/permissions/registry";
