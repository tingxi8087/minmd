import { resolve } from "node:path";
import { installWebFrontend } from "../../../system/server/src/plugins/web-frontend";
import { pruneExistingFileVersions } from "./modules/versions/retention";
import { createApp, type AppConfig, type AppOptions } from "@mas/system-server";
import { count, eq } from "drizzle-orm";
import { adminPermissions, appPermissions } from "../../../config/permissions";
import { appUserRoles } from "./database/schema/users";
import { files } from "./database/schema/files";
import { assets } from "./database/schema/assets";
import { AppError } from "../../../system/server/src/errors";
import { registerDocumentVerification } from "./modules/document-verification";
import { registerSheetVerification } from "./modules/sheet-verification";
import { registerFileAccess } from "./modules/file-access";
import { registerDevWeb } from "./modules/dev-web";
import { registerUsers } from "./modules/users";
import { registerUserAvatars } from "./modules/users/avatars";
import { registerSpaces } from "./modules/spaces";
import { registerFiles, assertSpaceEmpty } from "./modules/files";
import { initializeFileContent } from "./modules/collaboration/storage";
import { registerAssets } from "./modules/assets";
import { loadMinmdConfig, type MinmdAuthConfig } from "../../../config/minmd";
import {
  registerDocumentRooms,
  type DocumentRooms,
} from "./modules/collaboration/document-room";
import { registerFileBatches } from "./modules/files/batches";
import { registerFileTransfers } from "./modules/file-transfer";
import { registerContents } from "./modules/contents";
import { registerShares } from "./modules/shares";
import { registerDemoImports } from "./modules/demo-import";
import { registerAiRateLimit } from "./modules/api-keys/rate-limit";
import { registerMcp } from "./modules/mcp";
import { registerAi } from "./modules/ai";
import { registerApiKeys } from "./modules/api-keys";
import { registerVersions } from "./modules/versions";
import {
  registerSheetRooms,
  prepareSheet,
  type SheetRooms,
} from "./modules/collaboration/sheet-room";

export function buildApp(
  config?: AppConfig,
  options?: AppOptions,
  businessConfig?: MinmdAuthConfig,
) {
  const permissions = { admin: adminPermissions, app: appPermissions };
  return createApp({
    config,
    options: { forceCloseConnections: true, ...options },
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
      app.addHook("onReady", async () => {
        await pruneExistingFileVersions(database);
      });
      await registerDevWeb(app, config);
      let rooms: DocumentRooms | undefined;
      let sheetRooms: SheetRooms | undefined;
      await registerUsers(
        app,
        database,
        config,
        permissions,
        businessConfig ?? loadMinmdConfig(config),
        {
          onUserSessionsRevoked: (userId) => {
            rooms?.revokeUser(userId);
            sheetRooms?.revokeUser(userId);
          },
          onSessionRevoked: (sessionId) => {
            rooms?.revokeSession(sessionId);
            sheetRooms?.revokeSession(sessionId);
          },
        },
      );
      await registerSpaces(app, database, config, {
        beforeDelete: async (tx, spaceId) => {
          await assertSpaceEmpty(tx, spaceId);
          const [asset] = await tx
            .select({ id: assets.id })
            .from(assets)
            .where(eq(assets.spaceId, spaceId))
            .limit(1);
          if (asset)
            throw new AppError(
              "SPACE_ASSETS_PENDING",
              "空间仍有未清理附件，请等待附件宽限期清理后再删除",
              409,
            );
        },
        onMemberRemoved: async (spaceId, userId) => {
          const affected = await database.db
            .select({ id: files.id })
            .from(files)
            .where(eq(files.spaceId, spaceId));
          for (const file of affected)
            await Promise.all([
              rooms?.revalidateFilePermissions(file.id),
              sheetRooms?.revalidateFilePermissions(file.id),
            ]);
        },
      });
      await registerFiles(app, database, {
        onCreated: initializeFileContent,
        onDeleted: async (ids) => {
          rooms?.revokeFiles(ids);
          sheetRooms?.revokeFiles(ids);
        },
      });
      await registerAssets(app, database, config);
      await registerUserAvatars(
        app,
        database,
        config,
        loadMinmdConfig(config).assetStorageDir,
      );
      await registerApiKeys(
        app,
        database,
        config,
        loadMinmdConfig(config).aiKeyEncryptionKey,
      );
      registerAiRateLimit(
        app,
        database,
        loadMinmdConfig(config).aiRequestsPerMinute,
      );
      await registerDemoImports(app, database, {
        prepareSheet,
        assetStorageDir: loadMinmdConfig(config).assetStorageDir,
      });
      await registerSheetVerification(app, config);
      await registerDocumentVerification(app, config);
      sheetRooms = await registerSheetRooms(app, database, config);
      rooms = await registerDocumentRooms(app, database, config, sheetRooms);
      await registerContents(app, database, rooms, sheetRooms);
      await registerFileTransfers(app, {
        database,
        rooms,
        sheetRooms,
        assetDirectory: resolve(loadMinmdConfig(config).assetStorageDir),
        sourceOrigin: new URL(loadMinmdConfig(config).allowedOrigins[0]!)
          .origin,
      });
      await registerFileBatches(app, {
        database,
        rooms,
        sheetRooms,
        assetDirectory: resolve(loadMinmdConfig(config).assetStorageDir),
        sourceOrigin: new URL(loadMinmdConfig(config).allowedOrigins[0]!)
          .origin,
      });
      await registerFileAccess(app, database, {
        changed: async (fileId) => {
          await Promise.all([
            rooms!.revalidateFilePermissions(fileId),
            sheetRooms!.revalidateFilePermissions(fileId),
          ]);
        },
      });
      const ai = await registerAi(
        app,
        database,
        rooms,
        sheetRooms,
        loadMinmdConfig(config).assetStorageDir,
        loadMinmdConfig(config).aiExecutionTimeoutMs,
      );
      await registerMcp(app, database, config, ai);
      await registerVersions(app, database, rooms, sheetRooms);
      await registerShares(app, database, config, {
        changed: async (fileId) => {
          await Promise.all([
            rooms!.revalidateFilePermissions(fileId),
            sheetRooms!.revalidateFilePermissions(fileId),
          ]);
        },
        barrier: (fileId, kind) =>
          kind === "doc"
            ? rooms!.persistBarrier(fileId)
            : kind === "sheet"
              ? sheetRooms!.persistBarrier(fileId)
              : Promise.resolve(),
      });
      await installWebFrontend(app, config);
    },
  });
}
