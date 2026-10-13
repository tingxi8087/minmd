import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../../../../../system/server/src/database/client";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import type { AppConfig } from "../../../../../system/server/src/config/env";
import { AppError } from "../../../../../system/server/src/errors";
import {
  hashToken,
  newToken,
} from "../../../../../system/server/src/modules/auth/password";
import { fileContents, fileVersions } from "../../database/schema/contents";
import { appUsers, appUserSessions } from "../../database/schema/users";
import { files } from "../../database/schema/files";
import { requireFileAccess } from "../files/service";
import { lockSpace } from "../spaces/service";
import { syncContentAssets } from "../assets/service";
import { id } from "../spaces/schemas";
import { loadMinmdConfig } from "../../../../../config/minmd";
import { sheetCollaborationConfig } from "../../../../../config/sheet-collaboration";
import { SheetEngine, SheetEngineError } from "./sheet-engine";
import type {
  FortuneOperation,
  SheetCommand,
  SheetEngineSnapshot,
} from "./sheet-engine";

interface Identity {
  userId: string;
  sessionId: string;
  fileId: string;
  editSessionId: string;
  epoch: number;
}
interface Ticket extends Identity {
  expiresAt: number;
  consumed: boolean;
}
interface Socket {
  send(data: string): void;
  close(code: number, reason: string): void;
}
interface Connection {
  id: string;
  fileId: string;
  socket: Socket;
  identity?: Identity;
  displayName?: string;
  timeout: ReturnType<typeof setTimeout>;
  messages: number;
  window: number;
}
interface RecordedCommand {
  key: string;
  fingerprint: string;
  revision: number;
}
interface RecordedAiCommand {
  key: string;
  fingerprint: string;
  result: SheetCheckpoint;
}
export interface SheetAtomicMutation {
  fileId: string;
  userId: string;
  entityId: string;
  requestId: string;
  expectedRevision: number;
  expectedEpoch: number;
  operations: SheetCommand[];
  note?: string;
  beforeTransaction?: (tx: Transaction) => Promise<void>;
  authorize: (tx: Transaction) => Promise<void>;
  onCommitted: (tx: Transaction, result: SheetCheckpoint) => Promise<void>;
}
export interface SheetCheckpoint {
  fileId: string;
  revision: number;
  epoch: number;
  savedAt: string;
  versionId?: string;
}
export interface SheetReplacement {
  expectedRevision: number;
  expectedEpoch: number;
  projection: Record<string, unknown>;
  source: "import" | "restore" | "ai";
  note?: string;
}
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("MESSAGE_INVALID", "协作消息格式错误", 400);
  return value as JsonObject;
};
const sessionSource = (identity: Identity) =>
  JSON.stringify([identity.userId, identity.sessionId, identity.editSessionId]);
const engineState = (
  engine: SheetEngine,
  commands: RecordedCommand[] = [],
  aiCommands: RecordedAiCommand[] = [],
): JsonObject => ({
  ...object(engine.serialize()),
  roomCommands: commands.filter(
    (command) => command.revision > engine.minimumRevision,
  ),
  roomAICommands: aiCommands.filter(
    (command) => command.result.revision > engine.minimumRevision,
  ),
});
const projection = (snapshot: SheetEngineSnapshot): JsonObject => ({
  sheets: snapshot.workbook,
});
const summary = (
  current: typeof fileContents.$inferSelect,
): SheetCheckpoint => ({
  fileId: current.fileId,
  revision: current.revision,
  epoch: current.epoch,
  savedAt: current.updatedAt.toISOString(),
});
function sheetError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof SheetEngineError)
    return new AppError(
      error.code,
      error.message,
      ["CONTENT_TOO_LARGE", "MESSAGE_TOO_LARGE"].includes(error.code)
        ? 413
        : error.code === "INVALID_OPERATION"
          ? 400
          : 409,
    );
  return new AppError(
    "SAVE_FAILED",
    "服务器保存失败，请保留未确认内容并重试",
    503,
  );
}
function workbook(input: JsonObject): unknown {
  if (!Array.isArray(input.sheets))
    throw new AppError("CONTENT_INVALID", "表格内容须包含工作表数组", 400);
  return input.sheets;
}
/** 新建/本机演示导入在调用者事务内写入此初始化结果，稳定身份不会由浏览器生成。 */
export function prepareSheet(input: Record<string, unknown>): {
  projection: Record<string, unknown>;
  engineState: Record<string, unknown>;
} {
  try {
    const engine = new SheetEngine(workbook(input), { revision: 1, epoch: 1 });
    return {
      projection: projection(engine.snapshot()),
      engineState: engineState(engine),
    };
  } catch (error) {
    throw sheetError(error);
  }
}

/** 每份工作簿一个命令队列；候选状态只有在数据库事务提交后才对房间可见。 */
export class SheetRooms {
  private tickets = new Map<string, Ticket>();
  private connections = new Map<string, Connection>();
  private rooms = new Map<string, SheetEngine>();
  private queues = new Map<string, Promise<unknown>>();
  private closed = false;
  private historyTimer: ReturnType<typeof setInterval>;
  private limits = sheetCollaborationConfig();
  readonly maxSessions = this.limits.SHEET_COLLAB_MAX_SESSIONS;
  readonly maxMessageBytes = this.limits.SHEET_COLLAB_MAX_MESSAGE_BYTES;

  constructor(
    readonly database: Database,
    readonly config: AppConfig,
  ) {
    this.historyTimer = setInterval(() => {
      void Promise.allSettled(
        [...this.rooms.keys()].map((fileId) =>
          this.enqueue(fileId, () => this.automaticCheckpoint(fileId)),
        ),
      );
    }, 5 * 60_000);
    this.historyTimer.unref();
  }
  private enqueue<T>(fileId: string, task: () => Promise<T>): Promise<T> {
    const pending = (this.queues.get(fileId) ?? Promise.resolve())
      .catch(() => {})
      .then(task);
    this.queues.set(fileId, pending);
    return pending;
  }
  private async authorize(
    tx: Transaction | Database["db"],
    userId: string,
    fileId: string,
    identity?: Identity,
  ) {
    const file = await requireFileAccess(tx, userId, fileId, {
      permission: "edit",
    });
    if (file.kind !== "sheet")
      throw new AppError("FILE_KIND_INVALID", "仅表格支持此协作接口", 400);
    if (identity) {
      const [session] = await tx
        .select({ id: appUserSessions.id })
        .from(appUserSessions)
        .innerJoin(
          appUsers,
          and(
            eq(appUsers.id, appUserSessions.userId),
            eq(appUsers.status, "enabled"),
          ),
        )
        .where(
          and(
            eq(appUserSessions.id, identity.sessionId),
            eq(appUserSessions.userId, userId),
            eq(appUserSessions.transport, this.config.AUTH_TRANSPORT),
            isNull(appUserSessions.revokedAt),
            gt(appUserSessions.expiresAt, new Date()),
          ),
        )
        .for("share");
      if (!session)
        throw new AppError("SESSION_EXPIRED", "登录会话已失效", 401);
    }
    return file;
  }
  private async current(
    tx: Transaction,
    fileId: string,
    userId: string,
    identity?: Identity,
  ) {
    const file = await this.authorize(tx, userId, fileId, identity);
    await lockSpace(tx, file.spaceId);
    await this.authorize(tx, userId, fileId, identity);
    const [current] = await tx
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId))
      .for("update");
    if (!current || current.engine !== "fortune" || current.schemaVersion !== 1)
      throw new AppError("SCHEMA_UNSUPPORTED", "工作簿不存在或格式不兼容", 409);
    if (identity && current.epoch !== identity.epoch)
      throw new AppError("EPOCH_CONFLICT", "表格版本已切换，请重新加载", 409);
    return current;
  }
  private candidate(current: typeof fileContents.$inferSelect): SheetEngine {
    const cached = this.rooms.get(current.fileId);
    const engine =
      cached?.revision === current.revision && cached.epoch === current.epoch
        ? cached.fork()
        : current.engineState
          ? SheetEngine.restore(current.engineState)
          : new SheetEngine(workbook(current.projection), {
              revision: current.revision,
              epoch: current.epoch,
            });
    if (
      engine.revision !== current.revision ||
      engine.epoch !== current.epoch ||
      current.projectionRevision !== current.revision
    )
      throw new AppError(
        "CONTENT_INCONSISTENT",
        "工作簿权威状态与修订不一致",
        503,
      );
    return engine;
  }
  async issueTicket(
    userId: string,
    sessionId: string,
    fileId: string,
    schemaVersion = 1,
    editSessionId: string = randomUUID(),
  ) {
    if (schemaVersion !== 1)
      throw new AppError("SCHEMA_UNSUPPORTED", "客户端表格格式不兼容", 409);
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(editSessionId))
      throw new AppError("SESSION_INVALID", "编辑会话标识格式无效", 400);
    const initialized = await this.enqueue(fileId, () =>
      this.database.db.transaction(async (tx) => {
        const current = await this.current(tx, fileId, userId);
        const identity: Identity = {
          userId,
          sessionId,
          fileId,
          epoch: current.epoch,
          editSessionId,
        };
        await this.authorize(tx, userId, fileId, identity);
        const engine = this.candidate(current);
        if (!current.engineState) {
          const snapshot = engine.snapshot();
          await tx
            .update(fileContents)
            .set({
              engineState: engineState(engine),
              projection: projection(snapshot),
              projectionRevision: current.revision,
            })
            .where(eq(fileContents.fileId, fileId));
        }
        return { current, engine, identity };
      }),
    );
    this.rooms.set(fileId, initialized.engine);
    const ticket = newToken(),
      expiresAt = Date.now() + 60_000;
    this.tickets.set(hashToken(ticket), {
      ...initialized.identity,
      consumed: false,
      expiresAt,
    });
    for (const [key, value] of this.tickets)
      if (value.expiresAt <= Date.now()) this.tickets.delete(key);
    return {
      ticket,
      documentName: fileId,
      editSessionId,
      schemaVersion: 1,
      protocolVersion: 1,
      epoch: initialized.current.epoch,
      revision: initialized.current.revision,
      maxSessions: this.maxSessions,
      expiresAt: new Date(expiresAt).toISOString(),
      url: `/api/app/collaboration/sheets/${fileId}`,
    };
  }
  attach(fileId: string, socket: Socket): string {
    const id = randomUUID();
    const timeout = setTimeout(() => {
      socket.close(4003, "协作认证超时");
      this.detach(id);
    }, 10_000);
    timeout.unref();
    this.connections.set(id, {
      id,
      fileId,
      socket,
      timeout,
      messages: 0,
      window: Date.now(),
    });
    return id;
  }
  detach(id: string) {
    const connection = this.connections.get(id);
    if (!connection) return;
    clearTimeout(connection.timeout);
    this.connections.delete(id);
    if (connection.identity) this.members(connection.fileId);
  }
  private send(connection: Connection, packet: unknown) {
    try {
      connection.socket.send(JSON.stringify(packet));
    } catch {
      this.detach(connection.id);
    }
  }
  private broadcast(fileId: string, packet: unknown) {
    for (const connection of this.connections.values())
      if (connection.fileId === fileId && connection.identity)
        this.send(connection, packet);
  }
  private members(fileId: string) {
    const members = [...this.connections.values()]
      .filter((entry) => entry.fileId === fileId && entry.identity)
      .map((entry) => ({
        userId: entry.identity!.userId,
        displayName: entry.displayName,
        editSessionId: entry.identity!.editSessionId,
      }));
    this.broadcast(fileId, {
      type: "members",
      count: members.length,
      limit: this.maxSessions,
      members,
    });
  }
  private disconnect(connection: Connection, code: number, reason: string) {
    connection.socket.close(code, reason);
    this.detach(connection.id);
  }
  /** 以帧到达时间计数，不能把突发消息摊到慢事务消费时间里。 */
  acceptMessage(id: string): boolean {
    const connection = this.connections.get(id);
    if (!connection || this.closed) return false;
    if (Date.now() - connection.window >= 1000) {
      connection.window = Date.now();
      connection.messages = 0;
    }
    if (++connection.messages > this.limits.SHEET_COLLAB_MESSAGES_PER_SECOND) {
      this.disconnect(connection, 4007, "协作消息发送过于频繁");
      return false;
    }
    return true;
  }
  async receive(id: string, input: unknown, counted = false): Promise<void> {
    const connection = this.connections.get(id);
    if (!connection || this.closed || (!counted && !this.acceptMessage(id)))
      return;
    let packet: JsonObject;
    try {
      packet = object(input);
      if (!connection.identity) {
        if (
          packet.type !== "auth" ||
          typeof packet.ticket !== "string" ||
          packet.ticket.length > 500 ||
          packet.protocolVersion !== 1 ||
          packet.schemaVersion !== 1
        )
          throw new AppError(
            "AUTH_REQUIRED",
            "请先发送兼容的协作认证消息",
            401,
          );
        const ticket = this.tickets.get(hashToken(packet.ticket));
        if (
          !ticket ||
          ticket.consumed ||
          ticket.expiresAt <= Date.now() ||
          ticket.fileId !== connection.fileId
        )
          throw new AppError("TICKET_INVALID", "协作凭证无效或已使用", 401);
        ticket.consumed = true;
        await this.enqueue(connection.fileId, async () => {
          const result = await this.database.db.transaction(async (tx) => {
            const current = await this.current(
              tx,
              connection.fileId,
              ticket.userId,
              ticket,
            );
            const [user] = await tx
              .select({
                nickname: appUsers.nickname,
                account: appUsers.account,
              })
              .from(appUsers)
              .where(eq(appUsers.id, ticket.userId));
            return {
              current,
              engine: this.candidate(current),
              displayName: user?.nickname.trim() || user?.account || "编辑者",
            };
          });
          if (!this.connections.has(id)) return;
          const duplicate = [...this.connections.values()].find(
            (entry) =>
              entry.identity &&
              sessionSource(entry.identity) === sessionSource(ticket),
          );
          const count = [...this.connections.values()].filter(
            (entry) =>
              entry.fileId === connection.fileId &&
              entry.identity &&
              entry !== duplicate,
          ).length;
          if (count >= this.maxSessions)
            throw new AppError(
              "ROOM_FULL",
              `表格已达到 ${this.maxSessions} 个编辑会话上限`,
              409,
            );
          if (duplicate)
            this.disconnect(duplicate, 4003, "编辑会话已在其他连接重新建立");
          connection.identity = {
            userId: ticket.userId,
            sessionId: ticket.sessionId,
            fileId: ticket.fileId,
            epoch: ticket.epoch,
            editSessionId: ticket.editSessionId,
          };
          connection.displayName = result.displayName;
          clearTimeout(connection.timeout);
          this.rooms.set(connection.fileId, result.engine);
          this.send(connection, {
            type: "snapshot",
            ...result.engine.snapshot(),
            savedAt: result.current.updatedAt.toISOString(),
            editSessionId: ticket.editSessionId,
          });
          this.members(connection.fileId);
        });
        return;
      }
      const identity = connection.identity;
      if (packet.type === "ping" || packet.type === "presence") {
        await this.database.db.transaction(async (tx) => {
          await this.current(tx, identity.fileId, identity.userId, identity);
        });
        if (packet.type === "ping") this.send(connection, { type: "pong" });
        else {
          const selection = object(packet.selection);
          if (
            typeof selection.sheetId !== "string" ||
            !Number.isInteger(selection.row) ||
            !Number.isInteger(selection.column) ||
            Number(selection.row) < 0 ||
            Number(selection.row) >= 10_000 ||
            Number(selection.column) < 0 ||
            Number(selection.column) >= 1000
          )
            throw new AppError("MESSAGE_INVALID", "选区格式无效", 400);
          this.broadcast(identity.fileId, {
            type: "presence",
            userId: identity.userId,
            displayName: connection.displayName,
            editSessionId: identity.editSessionId,
            selection,
          });
        }
        return;
      }
      if (
        packet.type !== "operations" &&
        packet.type !== "undo" &&
        packet.type !== "redo"
      )
        throw new AppError("MESSAGE_INVALID", "不支持的协作消息", 400);
      if (
        typeof packet.operationId !== "string" ||
        !packet.operationId ||
        packet.operationId.length > 100 ||
        !Number.isInteger(packet.epoch)
      )
        throw new AppError("MESSAGE_INVALID", "操作标识或版本无效", 400);
      if (packet.epoch !== identity.epoch)
        throw new AppError("EPOCH_CONFLICT", "表格版本已切换", 409);
      const operationId = packet.operationId;
      const saved = await this.enqueue(identity.fileId, () =>
        this.mutate(identity, packet),
      );
      this.broadcast(identity.fileId, {
        type: "snapshot",
        ...saved.snapshot,
        savedAt: saved.checkpoint.savedAt,
        operationId,
        editSessionId: identity.editSessionId,
      });
      this.send(connection, { type: "ack", operationId, ...saved.checkpoint });
    } catch (error) {
      const failure = sheetError(error);
      if (
        !connection.identity ||
        [
          "SESSION_EXPIRED",
          "SPACE_FORBIDDEN",
          "FILE_DELETED",
          "NOT_FOUND",
          "EPOCH_CONFLICT",
        ].includes(failure.code)
      ) {
        this.send(connection, {
          type: "error",
          code: failure.code,
          message: failure.message,
        });
        this.disconnect(
          connection,
          failure.code === "ROOM_FULL"
            ? 4008
            : failure.code === "EPOCH_CONFLICT"
              ? 4009
              : 4003,
          failure.message,
        );
      } else
        this.send(connection, {
          type: "error",
          code: failure.code,
          message: failure.message,
          operationId:
            typeof input === "object" && input && "operationId" in input
              ? input.operationId
              : undefined,
        });
    }
  }
  private async mutate(identity: Identity, packet: JsonObject) {
    const saved = await this.database.db.transaction(async (tx) => {
      const current = await this.current(
          tx,
          identity.fileId,
          identity.userId,
          identity,
        ),
        engine = this.candidate(current);
      const source = sessionSource(identity),
        operationId = String(packet.operationId),
        key = JSON.stringify([source, operationId]);
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(packet))
        .digest("hex");
      const recorded = Array.isArray(current.engineState?.roomCommands)
        ? (current.engineState.roomCommands as RecordedCommand[])
        : [];
      const duplicate = recorded.find((entry) => entry.key === key);
      if (duplicate) {
        if (duplicate.fingerprint !== fingerprint)
          throw new AppError(
            "OPERATION_ID_CONFLICT",
            "操作标识已用于不同请求",
            409,
          );
        return {
          engine,
          snapshot: engine.snapshot(),
          checkpoint: summary(current),
        };
      }
      if (packet.type === "undo" || packet.type === "redo") {
        if (!Number.isInteger(packet.baseRevision))
          throw new AppError(
            "MESSAGE_INVALID",
            "撤销协议需要基准修订，请保留未确认副本并刷新客户端",
            400,
          );
        if (
          Number(packet.baseRevision) < engine.minimumRevision ||
          Number(packet.baseRevision) > engine.revision
        )
          throw new AppError(
            "REVISION_CONFLICT",
            "撤销请求已超过修订窗口，请保留恢复副本并重新载入",
            409,
          );
      }
      let snapshot: SheetEngineSnapshot;
      if (packet.type === "undo")
        snapshot = engine.undo(source, { epoch: identity.epoch });
      else if (packet.type === "redo")
        snapshot = engine.redo(source, { epoch: identity.epoch });
      else {
        if (
          !Number.isInteger(packet.baseRevision) ||
          !Array.isArray(packet.operations) ||
          !packet.operations.length ||
          packet.operations.length > 2000
        )
          throw new AppError("MESSAGE_INVALID", "操作批次或基准修订无效", 400);
        snapshot = engine.dispatch(
          source,
          Number(packet.baseRevision),
          operationId,
          packet.operations as (SheetCommand | FortuneOperation)[],
          { epoch: identity.epoch },
        );
      }
      const commands = [
        ...recorded,
        { key, fingerprint, revision: snapshot.revision },
      ];
      const [persisted] = await tx
        .update(fileContents)
        .set({
          revision: snapshot.revision,
          epoch: snapshot.epoch,
          engineState: engineState(
            engine,
            commands,
            Array.isArray(current.engineState?.roomAICommands)
              ? (current.engineState.roomAICommands as RecordedAiCommand[])
              : [],
          ),
          projection: projection(snapshot),
          projectionRevision: snapshot.revision,
          updatedAt:
            snapshot.revision === current.revision
              ? current.updatedAt
              : new Date(),
        })
        .where(eq(fileContents.fileId, identity.fileId))
        .returning();
      await syncContentAssets(
        tx,
        identity.fileId,
        persisted!.projection,
        undefined,
        identity.userId,
      );
      await tx
        .update(files)
        .set({ updatedAt: persisted!.updatedAt })
        .where(eq(files.id, identity.fileId));
      const [last] = await tx
        .select({ createdAt: fileVersions.createdAt })
        .from(fileVersions)
        .where(eq(fileVersions.fileId, identity.fileId))
        .orderBy(desc(fileVersions.createdAt))
        .limit(1);
      if (!last || Date.now() - last.createdAt.getTime() >= 5 * 60_000)
        await this.version(tx, persisted!, "auto", identity.userId);
      return { engine, snapshot, checkpoint: summary(persisted!) };
    });
    this.rooms.set(identity.fileId, saved.engine);
    return saved;
  }
  private async version(
    tx: Transaction,
    current: typeof fileContents.$inferSelect,
    source: string,
    actorId?: string,
    note = "",
    force = false,
  ) {
    const [last] = await tx
      .select({
        id: fileVersions.id,
        revision: fileVersions.revision,
        epoch: fileVersions.epoch,
      })
      .from(fileVersions)
      .where(eq(fileVersions.fileId, current.fileId))
      .orderBy(desc(fileVersions.createdAt), desc(fileVersions.revision))
      .limit(1);
    if (
      !force &&
      last?.revision === current.revision &&
      last.epoch === current.epoch
    )
      return last.id;
    const [version] = await tx
      .insert(fileVersions)
      .values({
        fileId: current.fileId,
        revision: current.revision,
        epoch: current.epoch,
        source,
        actorId,
        note,
        projection: current.projection,
        engineState: current.engineState,
      })
      .returning({ id: fileVersions.id });
    await syncContentAssets(
      tx,
      current.fileId,
      current.projection,
      version!.id,
    );
    return version!.id;
  }
  private async automaticCheckpoint(fileId: string) {
    const identity = [...this.connections.values()].find(
      (entry) => entry.fileId === fileId && entry.identity,
    )?.identity;
    if (!identity) return;
    await this.database.db.transaction(async (tx) => {
      const current = await this.current(tx, fileId, identity.userId, identity);
      await this.version(tx, current, "auto", identity.userId);
    });
  }
  async persistBarrier(
    fileId: string,
    revision?: number,
  ): Promise<SheetCheckpoint> {
    await this.queues.get(fileId)?.catch(() => {});
    const [current] = await this.database.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    if (!current || current.engine !== "fortune")
      throw new AppError("NOT_FOUND", "表格内容不存在", 404);
    if (revision !== undefined && current.revision < revision)
      throw new AppError("CHECKPOINT_PENDING", "指定表格操作尚未持久化", 409);
    return summary(current);
  }
  async checkpoint(
    userId: string,
    fileId: string,
    options: {
      manual?: boolean;
      note?: string;
      revision?: number;
      epoch?: number;
    } = {},
  ) {
    return this.enqueue(fileId, () =>
      this.database.db.transaction(async (tx) => {
        const current = await this.current(tx, fileId, userId);
        if (options.epoch !== undefined && options.epoch !== current.epoch)
          throw new AppError("EPOCH_CONFLICT", "表格版本已切换", 409);
        if (
          options.revision !== undefined &&
          options.revision > current.revision
        )
          throw new AppError(
            "CHECKPOINT_PENDING",
            "指定表格操作尚未持久化",
            409,
          );
        const saved = summary(current);
        if (options.manual)
          return {
            ...saved,
            versionId: await this.version(
              tx,
              current,
              "manual",
              userId,
              options.note ?? "",
            ),
          };
        return saved;
      }),
    );
  }
  /** AI 权限复核、内容、版本及调用者审计/幂等记录共同提交后才通知在线编辑者。 */
  async mutateWorkbookAtomic(
    input: SheetAtomicMutation,
  ): Promise<SheetCheckpoint> {
    if (
      !input.entityId ||
      input.entityId.length > 100 ||
      !input.requestId ||
      input.requestId.length > 100 ||
      !Number.isInteger(input.expectedRevision) ||
      !Number.isInteger(input.expectedEpoch) ||
      !input.operations.length ||
      input.operations.length > 2000 ||
      (input.note?.length ?? 0) > 200
    ) {
      throw new AppError(
        "MESSAGE_INVALID",
        "AI 操作标识、预期修订或批次无效",
        400,
      );
    }
    if (
      Buffer.byteLength(JSON.stringify(input.operations)) > this.maxMessageBytes
    )
      throw new AppError(
        "MESSAGE_TOO_LARGE",
        "AI 批次超过协作消息 UTF-8 字节上限",
        413,
      );
    const source = JSON.stringify(["ai", input.entityId]);
    const key = JSON.stringify([source, input.requestId]);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          expectedRevision: input.expectedRevision,
          expectedEpoch: input.expectedEpoch,
          operations: input.operations,
          note: input.note ?? "",
        }),
      )
      .digest("hex");
    try {
      const committed = await this.enqueue(input.fileId, () =>
        this.database.db.transaction(async (tx) => {
          await input.beforeTransaction?.(tx);
          const current = await this.current(tx, input.fileId, input.userId);
          await input.authorize(tx);
          const aiCommands = Array.isArray(current.engineState?.roomAICommands)
            ? (current.engineState.roomAICommands as RecordedAiCommand[])
            : [];
          const duplicate = aiCommands.find((command) => command.key === key);
          if (duplicate) {
            if (duplicate.fingerprint !== fingerprint)
              throw new AppError(
                "OPERATION_ID_CONFLICT",
                "请求标识已用于不同 AI 操作",
                409,
              );
            return { duplicate: true as const, checkpoint: duplicate.result };
          }
          if (
            current.epoch !== input.expectedEpoch ||
            current.revision !== input.expectedRevision
          )
            throw new AppError(
              "CONTENT_CONFLICT",
              "表格已发生变化，请重新读取后提交",
              409,
              {
                currentRevision: current.revision,
                currentEpoch: current.epoch,
              },
            );
          const engine = this.candidate(current);
          const snapshot = engine.dispatch(
            source,
            input.expectedRevision,
            input.requestId,
            input.operations,
            {
              expectedRevision: input.expectedRevision,
              epoch: input.expectedEpoch,
            },
          );
          const commands = Array.isArray(current.engineState?.roomCommands)
            ? (current.engineState.roomCommands as RecordedCommand[])
            : [];
          const now = new Date();
          const [persisted] = await tx
            .update(fileContents)
            .set({
              revision: snapshot.revision,
              epoch: snapshot.epoch,
              projection: projection(snapshot),
              projectionRevision: snapshot.revision,
              engineState: engineState(engine, commands, aiCommands),
              updatedAt: now,
            })
            .where(eq(fileContents.fileId, input.fileId))
            .returning();
          await syncContentAssets(
            tx,
            input.fileId,
            persisted!.projection,
            undefined,
            input.userId,
          );
          await tx
            .update(files)
            .set({ updatedAt: now })
            .where(eq(files.id, input.fileId));
          const checkpoint = {
            ...summary(persisted!),
            versionId: await this.version(
              tx,
              persisted!,
              "ai",
              input.userId,
              input.note ?? "",
              true,
            ),
          };
          await tx
            .update(fileContents)
            .set({
              engineState: engineState(engine, commands, [
                ...aiCommands,
                { key, fingerprint, result: checkpoint },
              ]),
            })
            .where(eq(fileContents.fileId, input.fileId));
          await input.onCommitted(tx, checkpoint);
          return { duplicate: false as const, checkpoint, engine, snapshot };
        }),
      );
      if (!committed.duplicate) {
        this.rooms.set(input.fileId, committed.engine);
        this.broadcast(input.fileId, {
          type: "snapshot",
          ...committed.snapshot,
          savedAt: committed.checkpoint.savedAt,
          operationId: input.requestId,
          source: "ai",
        });
      }
      return committed.checkpoint;
    } catch (error) {
      throw sheetError(error);
    }
  }
  async replaceWorkbook(
    fileId: string,
    userId: string,
    input: SheetReplacement,
  ) {
    const result = await this.enqueue(fileId, () =>
      this.database.db.transaction(async (tx) => {
        const current = await this.current(tx, fileId, userId);
        if (
          current.revision !== input.expectedRevision ||
          current.epoch !== input.expectedEpoch
        )
          throw new AppError(
            "CONTENT_CONFLICT",
            "表格已发生变化，请重新读取",
            409,
            { currentRevision: current.revision, currentEpoch: current.epoch },
          );
        const engine = this.candidate(current);
        await this.version(tx, current, "before-replace", userId);
        const snapshot = engine.replaceWorkbook(
          workbook(input.projection),
          input.expectedRevision,
        );
        const [saved] = await tx
          .update(fileContents)
          .set({
            projection: projection(snapshot),
            projectionRevision: snapshot.revision,
            revision: snapshot.revision,
            epoch: snapshot.epoch,
            engineState: engineState(engine),
            updatedAt: new Date(),
          })
          .where(eq(fileContents.fileId, fileId))
          .returning();
        await syncContentAssets(
          tx,
          fileId,
          saved!.projection,
          undefined,
          userId,
        );
        const versionId = await this.version(
          tx,
          saved!,
          input.source,
          userId,
          input.note ?? "",
          true,
        );
        return {
          engine,
          checkpoint: { ...summary(saved!), versionId },
          snapshot,
        };
      }),
    ).catch((error: unknown) => {
      throw sheetError(error);
    });
    this.rooms.set(fileId, result.engine);
    this.broadcast(fileId, {
      type: "epoch",
      epoch: result.snapshot.epoch,
      revision: result.snapshot.revision,
    });
    this.revokeFiles([fileId], "表格版本已切换，请重新加载", 4009);
    return result.checkpoint;
  }
  revokeUser(userId: string, spaceId?: string) {
    for (const connection of [...this.connections.values()])
      if (connection.identity?.userId === userId) {
        if (spaceId) {
          void this.database.db
            .select({ spaceId: files.spaceId })
            .from(files)
            .where(eq(files.id, connection.fileId))
            .then(([file]) => {
              if (file?.spaceId === spaceId)
                this.disconnect(connection, 4003, "空间权限已撤销");
            });
        } else this.disconnect(connection, 4003, "账号或空间权限已撤销");
      }
    for (const [key, ticket] of this.tickets)
      if (ticket.userId === userId) this.tickets.delete(key);
  }
  revokeSession(sessionId: string) {
    for (const connection of [...this.connections.values()])
      if (connection.identity?.sessionId === sessionId)
        this.disconnect(connection, 4003, "登录会话已撤销");
    for (const [key, ticket] of this.tickets)
      if (ticket.sessionId === sessionId) this.tickets.delete(key);
  }
  async revalidateFilePermissions(fileId: string) {
    for (const connection of [...this.connections.values()]) {
      if (connection.fileId !== fileId || !connection.identity) continue;
      try {
        await this.authorize(
          this.database.db,
          connection.identity.userId,
          fileId,
          connection.identity,
        );
      } catch {
        this.disconnect(connection, 4003, "表格编辑权限已撤销");
      }
    }
  }
  revokeFiles(ids: string[], reason = "文件访问权限已撤销", code = 4003) {
    const targets = new Set(ids);
    for (const connection of [...this.connections.values()])
      if (targets.has(connection.fileId))
        this.disconnect(connection, code, reason);
    for (const [key, ticket] of this.tickets)
      if (targets.has(ticket.fileId)) this.tickets.delete(key);
  }
  async close() {
    this.closed = true;
    clearInterval(this.historyTimer);
    for (const connection of [...this.connections.values()])
      this.disconnect(connection, 1001, "服务正在关闭");
    await Promise.allSettled([...this.queues.values()]);
    this.rooms.clear();
    this.tickets.clear();
  }
}

export async function registerSheetRooms(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
) {
  if (!app.hasDecorator("websocketServer"))
    await app.register(websocket, {
      options: {
        maxPayload: sheetCollaborationConfig().SHEET_COLLAB_MAX_MESSAGE_BYTES,
      },
      preClose: async () => {
        for (const socket of app.websocketServer.clients) socket.terminate();
        await new Promise<void>((resolve, reject) =>
          app.websocketServer.close((error) =>
            error ? reject(error) : resolve(),
          ),
        );
      },
    });
  const manager = new SheetRooms(database, config);
  app.addHook("onClose", () => manager.close());
  app.get<{ Params: { id: string } }>(
    "/api/app/collaboration/sheets/:id",
    {
      websocket: true,
      config: { auth: false },
      schema: {
        tags: ["表格协作"],
        summary: "连接表格协作房间",
        description:
          "首个JSON消息携带单次短期凭证；每次写入重新验证登录、成员资格、文件和epoch，禁止URL凭证。",
        params: Type.Object({ id }),
        response: { 200: Type.Object({}) },
      },
    },
    (socket, request) => {
      if (
        request.url.includes("?") ||
        (request.headers.origin &&
          !loadMinmdConfig(config).allowedOrigins.includes(
            request.headers.origin,
          ))
      ) {
        socket.close(4003, "协作来源或连接路径不合法");
        return;
      }
      const connection = manager.attach(request.params.id, socket);
      let pending: Promise<void> = Promise.resolve();
      socket.on("error", () => {});
      socket.on("message", (raw, binary) => {
        if (!manager.acceptMessage(connection)) return;
        if (binary) {
          socket.close(4003, "表格协作只接受JSON消息");
          return;
        }
        const bytes = Array.isArray(raw)
          ? Buffer.concat(raw)
          : raw instanceof ArrayBuffer
            ? Buffer.from(raw)
            : raw;
        if (bytes.length > manager.maxMessageBytes) {
          socket.close(4006, "协作消息超过配置的字节限制");
          return;
        }
        let input: unknown;
        try {
          input = JSON.parse(bytes.toString());
        } catch {
          socket.close(4003, "协作消息格式错误");
          return;
        }
        pending = pending
          .catch(() => {})
          .then(() => manager.receive(connection, input, true));
      });
      socket.once("close", () => manager.detach(connection));
    },
  );
  return manager;
}
