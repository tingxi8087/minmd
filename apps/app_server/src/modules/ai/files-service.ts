import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Database } from "../../../../../system/server/src/database/client";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import { AppError } from "../../../../../system/server/src/errors";
import { AiExecution } from "./execution";
import {
  aiRequests,
  apiKeys,
  type AiPermission,
} from "../../database/schema/ai";
import { authorizeAi, type AiIdentity } from "../api-keys/service";
import { lockSpace } from "../spaces/service";
import { requireFileAccess, fileResponse } from "../files/service";
import {
  createFile,
  renameFile,
  moveFile,
  deleteFile,
  restoreFile,
} from "../files/operations";
import type {
  CreateBody,
  PatchBody,
  MoveBody,
  RestoreBody,
} from "../files/schemas";
import { initializeFileContent } from "../collaboration/storage";
import { storeAsset } from "../assets/service";
import { bindPresentation } from "../assets/presentation";
import type { DocumentRooms } from "../collaboration/document-room";
import type { SheetRooms } from "../collaboration/sheet-room";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
class Replay extends AppError {
  constructor(readonly result: Record<string, unknown>) {
    super("AI_REQUEST_REPLAY", "请求已提交", 409);
  }
}
/** API Key使用独立权限授权，文件操作与成功幂等结果提交同一事务。 */
export class AiFileService {
  async readMetadata(token: string, fileId: string) {
    const guard = new AiExecution(this.executionTimeoutMs);
    const identity = await authorizeAi(this.database.db, token, "read");
    return guard.transaction(this.database, async (tx) => {
      await lockSpace(tx, identity.spaceId);
      const current = await authorizeAi(tx, token, "read");
      const file = await this.file(tx, current, fileId, true);
      await tx
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, current.keyId));
      return fileResponse(file);
    });
  }
  constructor(
    private database: Database,
    private documents: DocumentRooms,
    private sheets: SheetRooms,
    private directory: string,
    private executionTimeoutMs = 15000,
  ) {}
  private async replay(
    tx: Transaction,
    identity: AiIdentity,
    requestId: string,
    fingerprint: string,
  ) {
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId))
      throw new AppError(
        "REQUEST_ID_INVALID",
        "requestId需8–100位字母数字下划线或短横线",
        400,
      );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${identity.keyId + ":" + requestId}, 91733))`,
    );
    const [old] = await tx
      .select()
      .from(aiRequests)
      .where(
        and(
          eq(aiRequests.keyId, identity.keyId),
          eq(aiRequests.requestId, requestId),
        ),
      );
    if (old) {
      if (old.fingerprint !== fingerprint)
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "requestId已用于不同请求，请使用新的请求ID",
          409,
        );
      throw new Replay(old.result);
    }
  }
  private async record(
    tx: Transaction,
    identity: AiIdentity,
    requestId: string,
    fingerprint: string,
    result: Record<string, unknown>,
  ) {
    await tx
      .insert(aiRequests)
      .values({ keyId: identity.keyId, requestId, fingerprint, result });
    await tx
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, identity.keyId));
  }
  private async mutate(
    token: string,
    permission: AiPermission,
    requestId: string,
    input: unknown,
    operation: (
      tx: Transaction,
      identity: AiIdentity,
    ) => Promise<Record<string, unknown>>,
  ) {
    const guard = new AiExecution(this.executionTimeoutMs);
    const identity = await authorizeAi(this.database.db, token, permission);
    const fingerprint = createHash("sha256")
      .update(canonical({ permission, input }))
      .digest("hex");
    try {
      return await guard.transaction(this.database, async (tx) => {
        await lockSpace(tx, identity.spaceId);
        const current = await authorizeAi(tx, token, permission);
        await this.replay(tx, current, requestId, fingerprint);
        const result = await operation(tx, current);
        await this.record(tx, current, requestId, fingerprint, result);
        return result;
      });
    } catch (error) {
      if (error instanceof Replay) return error.result;
      throw guard.error(error);
    }
  }
  private async file(
    tx: Transaction,
    identity: AiIdentity,
    fileId: string,
    deleted = false,
  ) {
    const file = await requireFileAccess(tx, identity.userId, fileId, {
      deleted,
    });
    if (file.spaceId !== identity.spaceId)
      throw new AppError("AI_SPACE_MISMATCH", "密钥仅能操作绑定空间", 403);
    return file;
  }
  create(token: string, input: CreateBody & { requestId: string }) {
    return this.mutate(
      token,
      "create",
      input.requestId,
      { action: "create", ...input },
      async (tx, identity) =>
        fileResponse(
          await createFile(
            tx,
            identity.userId,
            identity.spaceId,
            input,
            initializeFileContent,
          ),
        ),
    );
  }
  rename(
    token: string,
    fileId: string,
    input: PatchBody & { requestId: string },
  ) {
    return this.mutate(
      token,
      "organize",
      input.requestId,
      { action: "rename", fileId, ...input },
      async (tx, identity) => {
        await this.file(tx, identity, fileId);
        return fileResponse(
          await renameFile(tx, identity.userId, fileId, input),
        );
      },
    );
  }
  move(token: string, fileId: string, input: MoveBody & { requestId: string }) {
    return this.mutate(
      token,
      "organize",
      input.requestId,
      { action: "move", fileId, ...input },
      async (tx, identity) => {
        await this.file(tx, identity, fileId);
        return fileResponse(await moveFile(tx, identity.userId, fileId, input));
      },
    );
  }
  async delete(
    token: string,
    fileId: string,
    input: { expectedMetadataRevision: number; requestId: string },
  ) {
    const result = await this.mutate(
      token,
      "delete_restore",
      input.requestId,
      { action: "delete", fileId, ...input },
      async (tx, identity) => {
        await this.file(tx, identity, fileId);
        return {
          ok: true,
          deletedIds: await deleteFile(
            tx,
            identity.userId,
            fileId,
            input.expectedMetadataRevision,
          ),
        };
      },
    );
    if (Array.isArray(result.deletedIds)) {
      const ids = result.deletedIds.filter(
        (id): id is string => typeof id === "string",
      );
      this.documents.revokeFiles(ids);
      this.sheets.revokeFiles(ids);
    }
    return result;
  }
  restore(
    token: string,
    fileId: string,
    input: RestoreBody & {
      expectedMetadataRevision: number;
      requestId: string;
    },
  ) {
    return this.mutate(
      token,
      "delete_restore",
      input.requestId,
      { action: "restore", fileId, ...input },
      async (tx, identity) => {
        await this.file(tx, identity, fileId, true);
        return fileResponse(
          await restoreFile(
            tx,
            identity.userId,
            fileId,
            input,
            input.expectedMetadataRevision,
          ),
        );
      },
    );
  }
  bindPresentation(
    token: string,
    fileId: string,
    input: {
      assetId: string;
      expectedRevision: number;
      expectedEpoch: number;
      requestId: string;
    },
  ) {
    return this.mutate(
      token,
      "edit",
      input.requestId,
      { action: "bind_presentation", fileId, ...input },
      async (tx, identity) => {
        await this.file(tx, identity, fileId);
        return bindPresentation(
          tx,
          this.directory,
          identity.userId,
          fileId,
          input,
        );
      },
    );
  }
  async upload(
    token: string,
    input: { requestId: string; filename: string; mime: string; bytes: Buffer },
  ) {
    if (!this.directory)
      throw new AppError("ASSET_STORAGE_UNAVAILABLE", "附件存储未配置", 503);
    const guard = new AiExecution(this.executionTimeoutMs);
    const identity = await authorizeAi(this.database.db, token, "upload");
    const fingerprint = createHash("sha256")
      .update(
        canonical({
          action: "upload",
          filename: input.filename,
          mime: input.mime,
          checksum: createHash("sha256").update(input.bytes).digest("hex"),
        }),
      )
      .digest("hex");
    try {
      return await storeAsset(
        this.database,
        this.directory,
        identity.userId,
        identity.spaceId,
        input.filename,
        input.mime,
        input.bytes,
        {
          authorize: async (tx) => {
            await guard.begin(tx);
            await lockSpace(tx, identity.spaceId);
            const current = await authorizeAi(tx, token, "upload");
            await this.replay(tx, current, input.requestId, fingerprint);
          },
          onCommitted: async (tx, result) => {
            guard.check();
            await this.record(
              tx,
              identity,
              input.requestId,
              fingerprint,
              result,
            );
            guard.check();
          },
        },
      );
    } catch (error) {
      if (error instanceof Replay) return error.result;
      throw guard.error(error);
    }
  }
}
