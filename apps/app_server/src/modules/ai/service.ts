import { and, eq, sql, count, isNull, ilike, asc } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Database } from "../../../../../system/server/src/database/client";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import { AppError } from "../../../../../system/server/src/errors";
import { apiKeys, aiRequests } from "../../database/schema/ai";
import { fileContents } from "../../database/schema/contents";
import { authorizeAi, authorizeAiFile } from "../api-keys/service";
import { files } from "../../database/schema/files";
import { fileResponses } from "../files/service";
import { lockSpace } from "../spaces/service";
import type { DocumentRooms } from "../collaboration/document-room";
import type { DocumentCommand } from "../collaboration/document-commands";
import type { SheetRooms } from "../collaboration/sheet-room";
import { AiFileService } from "./files-service";
import { AiExecution } from "./execution";
import type { WorkbookUpdate, WorkbookRead } from "./workbook";
import {
  workbookCommands,
  workbookReadSchema,
  workbookUpdateSchema,
} from "./workbook";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
class Replay extends AppError {
  constructor(readonly result: Record<string, unknown>) {
    super("AI_REQUEST_REPLAY", "已经提交的AI请求", 409);
  }
}
export class AiService {
  readonly files: AiFileService;
  constructor(
    private database: Database,
    private documents: DocumentRooms,
    private sheets: SheetRooms,
    assetStorageDir = "",
    private executionTimeoutMs = 15000,
  ) {
    this.files = new AiFileService(
      database,
      documents,
      sheets,
      assetStorageDir,
      executionTimeoutMs,
    );
  }
  async listFiles(
    token: string,
    input: {
      page?: number;
      pageSize?: number;
      search?: string;
      parentId?: string;
    },
  ) {
    const guard = new AiExecution(this.executionTimeoutMs);
    const identity = await authorizeAi(this.database.db, token, "read");
    return guard.transaction(this.database, async (tx) => {
      await lockSpace(tx, identity.spaceId);
      await authorizeAi(tx, token, "read");
      const conditions = [
        eq(files.spaceId, identity.spaceId),
        isNull(files.deletedAt),
      ];
      if (input.parentId) {
        const access = await authorizeAiFile(tx, token, "read", input.parentId);
        if (access.file.kind !== "doc" && access.file.kind !== "folder")
          throw new AppError("PARENT_INVALID", "父节点不是文档或文件夹", 400);
        conditions.push(eq(files.parentId, input.parentId));
      }
      if (input.search)
        conditions.push(
          ilike(files.name, `%${input.search.replace(/[\\%_]/g, "\\$&")}%`),
        );
      const where = and(...conditions);
      const [amount] = await tx
        .select({ total: count() })
        .from(files)
        .where(where);
      const total = amount!.total,
        pageSize = input.pageSize ?? 50,
        page = Math.min(
          input.page ?? 1,
          Math.max(1, Math.ceil(total / pageSize)),
        );
      const rows = await tx
        .select()
        .from(files)
        .where(where)
        .orderBy(asc(files.position), files.id)
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      await this.used(tx, identity.keyId);
      return {
        items: await fileResponses(tx, identity.userId, rows),
        total,
        page,
        pageSize,
      };
    });
  }
  async readDocument(token: string, fileId: string, blockIds?: string[]) {
    const guard = new AiExecution(this.executionTimeoutMs);
    const access = await authorizeAiFile(
      this.database.db,
      token,
      "read",
      fileId,
    );
    if (access.file.kind !== "doc")
      throw new AppError("FILE_KIND_INVALID", "目标不是文档", 400);
    await this.documents.persistBarrier(fileId);
    return guard.transaction(this.database, async (tx) => {
      await lockSpace(tx, access.identity.spaceId);
      const currentAccess = await authorizeAiFile(tx, token, "read", fileId);
      const [current] = await tx
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId));
      if (!current || current.projectionRevision !== current.revision)
        throw new AppError(
          "PROJECTION_PENDING",
          "正文检查点尚未就绪，请重试",
          409,
        );
      let projection = current.projection;
      if (blockIds?.length) {
        const selected: Record<string, unknown>[] = [];
        const ids = new Set(blockIds);
        const walk = (node: unknown) => {
          if (!node || typeof node !== "object") return;
          const item = node as Record<string, unknown>;
          const attrs = item.attrs as Record<string, unknown> | undefined;
          if (typeof attrs?.blockId === "string" && ids.has(attrs.blockId))
            selected.push(item);
          if (Array.isArray(item.content)) item.content.forEach(walk);
        };
        walk(projection);
        if (selected.length !== ids.size)
          throw new AppError(
            "BLOCK_NOT_FOUND",
            "指定块不存在，请重新读取文档",
            404,
          );
        projection = { type: "doc", content: selected };
      }
      const result = {
        fileId,
        revision: current.revision,
        epoch: current.epoch,
        schemaVersion: current.schemaVersion,
        projection,
      };
      if (Buffer.byteLength(JSON.stringify(result)) > 512 * 1024)
        throw new AppError(
          "AI_RESPONSE_TOO_LARGE",
          "文档较大，请指定blockIds分批读取",
          413,
        );
      await this.used(tx, currentAccess.identity.keyId);
      return result;
    });
  }
  private async used(tx: Transaction, keyId: string) {
    await tx
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, keyId));
  }
  async readWorkbook(token: string, fileId: string, query: WorkbookRead = {}) {
    const parsed = workbookReadSchema.safeParse(query);
    if (!parsed.success)
      throw new AppError("RANGE_INVALID", "工作表读取范围无效", 400);
    const guard = new AiExecution(this.executionTimeoutMs);
    const access = await authorizeAiFile(
      this.database.db,
      token,
      "read",
      fileId,
    );
    if (access.file.kind !== "sheet")
      throw new AppError("FILE_KIND_INVALID", "目标不是表格", 400);
    await this.sheets.persistBarrier(fileId);
    return guard.transaction(this.database, async (tx) => {
      await lockSpace(tx, access.identity.spaceId);
      const identity = await authorizeAiFile(tx, token, "read", fileId);
      const [current] = await tx
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId));
      if (
        !current ||
        current.engine !== "fortune" ||
        current.projectionRevision !== current.revision
      )
        throw new AppError("PROJECTION_PENDING", "表格权威检查点未就绪", 409);
      const sheets = current.projection.sheets as Record<string, unknown>[];
      const metadata = sheets.map((sheet) => ({
        sheetId: String(sheet.id),
        name: String(sheet.name),
        rows: Number(sheet.row),
        columns: Number(sheet.column),
      }));
      let range: Record<string, unknown> | undefined;
      if (query.sheetId) {
        const sheet = sheets.find((item) => item.id === query.sheetId);
        if (!sheet) throw new AppError("SHEET_NOT_FOUND", "工作表不存在", 404);
        const startRow = query.startRow ?? 0,
          startColumn = query.startColumn ?? 0;
        const endRow =
            query.endRow ?? Math.min(Number(sheet.row) - 1, startRow + 49),
          endColumn =
            query.endColumn ??
            Math.min(Number(sheet.column) - 1, startColumn + 19);
        if (
          startRow > endRow ||
          startColumn > endColumn ||
          endRow >= Number(sheet.row) ||
          endColumn >= Number(sheet.column) ||
          (endRow - startRow + 1) * (endColumn - startColumn + 1) > 2000
        )
          throw new AppError(
            "RANGE_INVALID",
            "范围越界或超过2000个单元格，请分批读取",
            400,
          );
        const matrix = sheet.data as (Record<string, unknown> | null)[][];
        const cells: Record<string, unknown>[] = [];
        for (let row = startRow; row <= endRow; row++)
          for (let column = startColumn; column <= endColumn; column++) {
            const cell = matrix?.[row]?.[column] ?? {};
            const { v, f, m: _display, ...format } = cell;
            cells.push({
              row,
              column,
              value: v ?? null,
              formula: typeof f === "string" ? f : null,
              ...(query.includeFormat ? { format } : {}),
            });
          }
        range = {
          sheetId: query.sheetId,
          startRow,
          endRow,
          startColumn,
          endColumn,
          cells,
        };
      }
      const result = {
        fileId,
        revision: current.revision,
        epoch: current.epoch,
        schemaVersion: current.schemaVersion,
        sheets: metadata,
        ...(range ? { range } : {}),
      };
      if (Buffer.byteLength(JSON.stringify(result)) > 512 * 1024)
        throw new AppError(
          "AI_RESPONSE_TOO_LARGE",
          "读取结果过大，请缩小单元格范围",
          413,
        );
      await this.used(tx, identity.identity.keyId);
      return result;
    });
  }
  async updateWorkbook(token: string, fileId: string, raw: WorkbookUpdate) {
    const parsed = workbookUpdateSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError("WORKBOOK_COMMAND_INVALID", "工作簿命令格式无效", 400);
    const input = parsed.data;
    const guard = new AiExecution(this.executionTimeoutMs);
    const access = await authorizeAiFile(
      this.database.db,
      token,
      "edit",
      fileId,
    );
    if (access.file.kind !== "sheet")
      throw new AppError("FILE_KIND_INVALID", "目标不是表格", 400);
    const fingerprint = createHash("sha256")
      .update(canonical({ fileId, ...input }))
      .digest("hex");
    const operations = workbookCommands(input);
    const touchedSheetIds = [
      ...new Set(input.operations.map((operation) => operation.sheetId)),
    ];
    const touchedRanges = input.operations.flatMap((operation) =>
      operation.type === "set_cells"
        ? [
            {
              sheetId: operation.sheetId,
              startRow: operation.startRow,
              endRow: operation.startRow + operation.cells.length - 1,
              startColumn: operation.startColumn,
              endColumn:
                operation.startColumn +
                Math.max(...operation.cells.map((row) => row.length)) -
                1,
            },
          ]
        : operation.type === "clear_range" || operation.type === "format_range"
          ? [
              {
                sheetId: operation.sheetId,
                startRow: operation.startRow,
                endRow: operation.endRow,
                startColumn: operation.startColumn,
                endColumn: operation.endColumn,
              },
            ]
          : [],
    );
    try {
      const committed = await this.sheets.mutateWorkbookAtomic({
        fileId,
        userId: access.identity.userId,
        entityId: access.identity.keyId,
        ...input,
        operations,
        beforeTransaction: (tx) => guard.begin(tx),
        authorize: async (tx) => {
          const current = await authorizeAiFile(tx, token, "edit", fileId);
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${current.identity.keyId + ":" + input.requestId}, 91733))`,
          );
          const [old] = await tx
            .select()
            .from(aiRequests)
            .where(
              and(
                eq(aiRequests.keyId, current.identity.keyId),
                eq(aiRequests.requestId, input.requestId),
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
        },
        onCommitted: async (tx, result) => {
          guard.check();
          await tx.insert(aiRequests).values({
            keyId: access.identity.keyId,
            requestId: input.requestId,
            fingerprint,
            result: {
              ...result,
              touchedSheetIds,
              touchedRanges,
            },
          });
          await this.used(tx, access.identity.keyId);
          guard.check();
        },
      });
      return {
        ...committed,
        touchedSheetIds,
        touchedRanges,
      };
    } catch (error) {
      if (error instanceof Replay) return error.result;
      throw guard.error(error);
    }
  }
  async updateDocument(
    token: string,
    fileId: string,
    input: {
      requestId: string;
      expectedRevision: number;
      expectedEpoch: number;
      operations: DocumentCommand[];
    },
  ) {
    const guard = new AiExecution(this.executionTimeoutMs);
    const access = await authorizeAiFile(
      this.database.db,
      token,
      "edit",
      fileId,
    );
    const fingerprint = createHash("sha256")
      .update(canonical({ fileId, ...input }))
      .digest("hex");
    try {
      return await this.documents.mutateDocumentAtomic(
        fileId,
        access.identity.userId,
        {
          ...input,
          beforeTransaction: (tx) => guard.begin(tx),
          authorize: async (tx) => {
            const current = await authorizeAiFile(tx, token, "edit", fileId);
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${current.identity.keyId + ":" + input.requestId}, 91733))`,
            );
            const [old] = await tx
              .select()
              .from(aiRequests)
              .where(
                and(
                  eq(aiRequests.keyId, current.identity.keyId),
                  eq(aiRequests.requestId, input.requestId),
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
          },
          onCommitted: async (tx, result) => {
            guard.check();
            await tx.insert(aiRequests).values({
              keyId: access.identity.keyId,
              requestId: input.requestId,
              fingerprint,
              result,
            });
            await this.used(tx, access.identity.keyId);
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
