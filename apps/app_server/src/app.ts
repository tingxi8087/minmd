import { createApp, type AppConfig, type AppOptions } from "@mas/system-server";
import { count, eq } from "drizzle-orm";
import { adminPermissions, appPermissions } from "../../../config/permissions";
import { appUserRoles } from "./database/schema/users";
import { registerUsers } from "./modules/users";

export function buildApp(config?: AppConfig, options?: AppOptions) {
  const permissions = { admin: adminPermissions, app: appPermissions };
  return createApp({
    config,
    options,
    permissions,
    appRoleMembership: {
      count: async (tx, id) => {
        const [row] = await tx
          .select({ value: count() })
          .from(appUserRoles)
          .where(eq(appUserRoles.roleId, id));
        return row!.value;
      },
    },
    register: async (app, { database, config }) => {
      await registerUsers(app, database, config, permissions);
    },
  });
}
