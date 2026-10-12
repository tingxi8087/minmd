import { Hocuspocus, type Document } from "@hocuspocus/server";
import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import { and, eq, gt, isNull, desc, lt, or } from "drizzle-orm";
import { Type } from "@sinclair/typebox";
import * as Y from "yjs";
import type { JSONContent } from "@tiptap/core";
import type { Database } from "../../../../../system/server/src/database/client";
import type { AppConfig } from "../../../../../system/server/src/config/env";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import { AppError } from "../../../../../system/server/src/errors";
import {
  newToken,
  hashToken,
} from "../../../../../system/server/src/modules/auth/password";
import { appUsers, appUserSessions } from "../../database/schema/users";
import { files } from "../../database/schema/files";
import {
  fileContents,
  fileVersions,
  documentUpdates,
} from "../../database/schema/contents";
import { requireFileAccess } from "../files/service";
import { lockSpace } from "../spaces/service";
import {
  documentProjection,
  createDocumentState,
  normalizeDocument,
  documentSchema,
} from "./document-schema";
import { documentCollaborationConfig } from "../../../../../config/document-collaboration";
import { loadMinmdConfig } from "../../../../../config/minmd";
import { id, errors } from "../spaces/schemas";
import type { SheetRooms } from "./sheet-room";
import { syncContentAssets } from "../assets/service";
import {
  applyDocumentCommands,
  type DocumentCommand,
} from "./document-commands";
export type { DocumentCommand } from "./document-commands";
const committedAiOrigin = { source: "local", skipStoreHooks: true } as const;
/** 屏障要求已持久状态覆盖调用方更新；其他编辑者领先不构成冲突。 */
export function snapshotContains(wanted: Y.Snapshot, current: Y.Snapshot) {
  for (const [client, clock] of wanted.sv)
    if ((current.sv.get(client) ?? 0) < clock) return false;
  for (const [client, ranges] of wanted.ds.clients) {
    const saved = current.ds.clients.get(client) ?? [];
    for (const range of ranges)
      if (
        !saved.some(
          (item) =>
            item.clock <= range.clock &&
            item.clock + item.len >= range.clock + range.len,
        )
      )
        return false;
  }
  return true;
}
interface Context {
  fileId: string;
  userId: string;
  sessionId: string;
  epoch: number;
  socketId: string;
}
interface Ticket extends Omit<Context, "socketId"> {
  expiresAt: number;
  consumed: boolean;
}
export interface Checkpoint {
  fileId: string;
  revision: number;
  epoch: number;
  savedAt: string;
  versionId?: string;
}
export type DocumentMutationResult = {
  fileId: string;
  revision: number;
  epoch: number;
  savedAt: string;
  versionId: string;
  touchedBlockIds: string[];
};
export interface Replacement {
  expectedRevision: number;
  expectedEpoch: number;
  projection: JSONContent;
  source: "import" | "restore" | "ai";
  note?: string;
}
interface PendingDocumentSave {
  update: Uint8Array;
  contexts: Map<string, Context>;
  deadline: ReturnType<typeof setTimeout>;
}
const saveDebounceMs = 500;
const saveMaxWaitMs = 2000;
export class DocumentRooms {
  readonly server: Hocuspocus<Context>;
  private tickets = new Map<string, Ticket>();
  private sockets = new Map<
    string,
    { context: Context; close: (code: number, reason: string) => void }
  >();
  private epochs = new Map<string, number>();
  private queues = new Map<string, Promise<Checkpoint>>();
  private paused = new Set<string>();
  private pendingSaves = new Map<string, PendingDocumentSave>();
  private closing = false;
  private activeSaves = new Map<string, Set<PendingDocumentSave>>();
  private contexts = new Map<string, Context>();
  private historyTimer: ReturnType<typeof setInterval>;
  readonly maxSessions = documentCollaborationConfig().DOC_COLLAB_MAX_SESSIONS;
  readonly messagesPerSecond =
    documentCollaborationConfig().DOC_COLLAB_MESSAGES_PER_SECOND;
  constructor(
    readonly database: Database,
    readonly config: AppConfig,
  ) {
    this.server = new Hocuspocus<Context>({
      quiet: true,
      debounce: saveDebounceMs,
      maxDebounce: saveMaxWaitMs,
      onAuthenticate: async ({ token, documentName, context, socketId }) => {
        const ticket = this.tickets.get(hashToken(token));
        if (
          !ticket ||
          ticket.consumed ||
          ticket.expiresAt <= Date.now() ||
          ticket.fileId !== documentName ||
          documentName !== context.fileId
        )
          throw { code: 4003, reason: "协作凭证无效或已过期" };
        if (this.paused.has(documentName))
          throw { code: 4009, reason: "文档正在执行内容命令，请稍后重连" };
        const identity = { ...ticket, socketId };
        await this.validate(identity);
        const count = [...this.sockets.values()].filter(
          (row) => row.context.fileId === documentName && row.context.userId,
        ).length;
        if (count >= this.maxSessions)
          throw {
            code: 4008,
            reason: `文档已达到 ${this.maxSessions} 个编辑会话上限`,
          };
        if (ticket.consumed) throw { code: 4003, reason: "协作凭证已使用" };
        ticket.consumed = true;
        const socket = this.sockets.get(context.socketId);
        if (socket) {
          socket.context = identity;
          this.sockets.delete(context.socketId);
          this.sockets.set(socketId, socket);
        }
        return identity;
      },
      onLoadDocument: async ({ documentName, document, context }) => {
        const current = await this.validate(context);
        this.epochs.set(documentName, current.epoch);
        if (!current.documentState) throw new Error("文档权威状态缺失");
        Y.applyUpdate(document, current.documentState);
        return document;
      },
      beforeHandleMessage: async ({ context }) => {
        try {
          await this.validate(context);
        } catch {
          this.sockets
            .get(context.socketId)
            ?.close(4003, "登录或文件访问权限已失效");
          throw { code: 4003, reason: "登录或文件访问权限已失效" };
        }
        if (this.paused.has(context.fileId))
          throw { code: 4009, reason: "文档正在切换版本，请重新加载" };
      },
      beforeSync: async ({ context, document, type, payload }) => {
        if (this.paused.has(context.fileId))
          throw { code: 4009, reason: "文档正在切换版本" };
        if (type === 1 || type === 2) {
          const copy = new Y.Doc();
          try {
            Y.applyUpdate(copy, Y.encodeStateAsUpdate(document));
            Y.applyUpdate(copy, payload);
            if (Y.encodeStateAsUpdate(copy).byteLength > 8 * 1024 * 1024)
              throw new AppError(
                "CONTENT_TOO_LARGE",
                "文档权威状态超过8MB限制",
                413,
              );
            this.checkProjection(documentProjection(copy));
            // 在隔离状态补齐块身份，只追加同世代 Yjs 更新，不重建正文覆盖并发。
            const seen = new Set<string>();
            let repaired = false;
            const visit = (parent: Y.XmlFragment | Y.XmlElement) => {
              for (const child of parent.toArray()) {
                if (!(child instanceof Y.XmlElement)) continue;
                if (documentSchema.nodes[child.nodeName]?.isBlock) {
                  const blockId = child.getAttribute("blockId");
                  if (
                    typeof blockId !== "string" ||
                    !/^[a-zA-Z0-9_-]{1,80}$/.test(blockId) ||
                    seen.has(blockId)
                  ) {
                    const assigned = crypto.randomUUID();
                    child.setAttribute("blockId", assigned);
                    seen.add(assigned);
                    repaired = true;
                  } else seen.add(blockId);
                }
                visit(child);
              }
            };
            copy.transact(() => visit(copy.getXmlFragment("default")));
            if (repaired) {
              this.checkProjection(documentProjection(copy));
              Y.applyUpdate(
                document,
                Y.encodeStateAsUpdate(copy, Y.encodeStateVector(document)),
                { source: "local", context },
              );
            }
          } catch {
            this.sockets
              .get(context.socketId)
              ?.close(4003, "文档内容格式无效，请保留本地副本后重新加载");
            throw {
              code: 4003,
              reason: "文档内容格式无效，请保留本地副本后重新加载",
            };
          } finally {
            copy.destroy();
          }
        }
      },
      onChange: async ({
        documentName,
        update,
        context,
        transactionOrigin,
      }) => {
        // AI 的候选状态、历史和请求账本已经在同一事务提交，广播不再重复保存。
        if (transactionOrigin === committedAiOrigin) return;
        if (context?.userId) this.contexts.set(documentName, context);
        const pending = this.pendingSaves.get(documentName);
        if (pending) {
          pending.update = Y.mergeUpdates([pending.update, update]);
          if (context?.userId) pending.contexts.set(context.sessionId, context);
        } else {
          // 原库的 maxDebounce 仅在下一次更新时检查；独立截止计时保证持续输入也在两秒内开始落库。
          const deadline = this.saveDeadline(documentName);
          this.pendingSaves.set(documentName, {
            update: update.slice(),
            contexts: new Map(
              context?.userId ? [[context.sessionId, context]] : [],
            ),
            deadline,
          });
        }
      },
      onStoreDocument: async ({ documentName }) => {
        try {
          await this.persistBarrier(documentName);
        } catch {
          throw new Error("文档协作持久化失败，请保留未确认草稿");
        }
      },
      onStateless: async ({ documentName, document, connection, payload }) => {
        if (payload === "ready" || payload === "initialize") {
          const snapshot = Array.from(Y.encodeSnapshot(Y.snapshot(document)));
          const current = await this.persistBarrier(documentName);
          connection.sendStateless(
            JSON.stringify({
              type: "ready",
              ...current,
              schemaVersion: 1,
              protocolVersion: 1,
            }),
          );
          connection.sendStateless(
            JSON.stringify({
              type: "saved",
              ...current,
              snapshot,
            }),
          );
          this.members(documentName);
        }
      },
      onDisconnect: async ({ socketId, documentName }) => {
        this.sockets.delete(socketId);
        this.members(documentName);
      },
    });
    this.historyTimer = setInterval(() => {
      void this.runPeriodicVersions();
    }, 60000);
    this.historyTimer.unref();
  }
  /** 内部周期维护入口；文件已持久化且距上次版本满五分钟时才尝试生成变化检查点。 */
  async runPeriodicVersions(
    fileIds: Iterable<string> = this.server.documents.keys(),
  ) {
    for (const fileId of fileIds) {
      try {
        await this.persistBarrier(fileId);
        await this.database.db.transaction(async (tx) => {
          const [current] = await tx
            .select()
            .from(fileContents)
            .where(eq(fileContents.fileId, fileId))
            .for("update");
          if (!current) return;
          const [last] = await tx
            .select()
            .from(fileVersions)
            .where(eq(fileVersions.fileId, fileId))
            .orderBy(desc(fileVersions.createdAt))
            .limit(1);
          if (!last || Date.now() - last.createdAt.getTime() >= 5 * 60000)
            await this.version(
              tx,
              current,
              "auto",
              this.contexts.get(fileId)?.userId,
            );
        });
      } catch {
        /* 未确认状态仍在房间内，下一次持久化重试；不产生虚假历史。 */
      }
    }
  }
  private checkProjection(projection: JSONContent) {
    if (Buffer.byteLength(JSON.stringify(projection)) > 8 * 1024 * 1024)
      throw new AppError("CONTENT_TOO_LARGE", "文档超过8MB限制", 413);
    normalizeDocument(projection);
  }
  private saveDeadline(fileId: string) {
    const deadline = setTimeout(() => {
      // 提前执行原库的保存钩子，同时重置它的防抖窗口，避免截止保存后又立即重复提交下一批。
      const scheduled = this.server.debouncer.executeNow(
        `onStoreDocument-${fileId}`,
      );
      void Promise.resolve(scheduled ?? this.persistBarrier(fileId)).catch(
        () => {},
      );
    }, saveMaxWaitMs);
    deadline.unref();
    return deadline;
  }
  private members(fileId: string) {
    const count = [...this.sockets.values()].filter(
      (row) => row.context.fileId === fileId && row.context.userId,
    ).length;
    this.server.documents
      .get(fileId)
      ?.broadcastStateless(
        JSON.stringify({ type: "members", count, limit: this.maxSessions }),
      );
  }
  private async validate(context: Context | Ticket) {
    const [session] = await this.database.db
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
          eq(appUserSessions.id, context.sessionId),
          eq(appUserSessions.userId, context.userId),
          isNull(appUserSessions.revokedAt),
          gt(appUserSessions.expiresAt, new Date()),
          eq(appUserSessions.transport, this.config.AUTH_TRANSPORT),
        ),
      );
    if (!session) throw { code: 4003, reason: "登录已失效" };
    try {
      const file = await requireFileAccess(
        this.database,
        context.userId,
        context.fileId,
        { permission: "edit" },
      );
      if (file.kind !== "doc") throw Error("类型无效");
      const [current] = await this.database.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, file.id));
      if (
        !current ||
        current.engine !== "yjs" ||
        current.schemaVersion !== 1 ||
        current.epoch !== context.epoch
      )
        throw { code: 4009, reason: "文档版本已切换，请重新读取" };
      return current;
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        error.code === 4009
      )
        throw error;
      throw { code: 4003, reason: "文件访问权限已失效" };
    }
  }
  async issueTicket(
    userId: string,
    sessionId: string,
    fileId: string,
    schemaVersion = 1,
  ) {
    if (schemaVersion !== 1)
      throw new AppError("SCHEMA_UNSUPPORTED", "客户端文档格式不兼容", 409);
    const file = await requireFileAccess(this.database, userId, fileId, {
      permission: "edit",
    });
    if (file.kind !== "doc")
      throw new AppError("FILE_KIND_INVALID", "仅文档支持此协作接口", 400);
    const [current] = await this.database.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    if (!current || current.schemaVersion !== 1)
      throw new AppError("SCHEMA_UNSUPPORTED", "文档格式不兼容", 409);
    const ticket = newToken();
    const expiresAt = Date.now() + 60000;
    this.tickets.set(hashToken(ticket), {
      fileId,
      userId,
      sessionId,
      epoch: current.epoch,
      expiresAt,
      consumed: false,
    });
    for (const [key, value] of this.tickets)
      if (value.expiresAt < Date.now()) this.tickets.delete(key);
    return {
      ticket,
      documentName: fileId,
      epoch: current.epoch,
      revision: current.revision,
      schemaVersion: 1,
      protocolVersion: 1,
      maxSessions: this.maxSessions,
      expiresAt: new Date(expiresAt).toISOString(),
      url: `/api/app/collaboration/documents/${fileId}`,
    };
  }
  private enqueue<T extends Checkpoint>(
    fileId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const task = (this.queues.get(fileId) ?? Promise.resolve())
      .catch(() => {})
      .then(fn);
    this.queues.set(fileId, task);
    return task;
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
      .select()
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
        documentState: current.documentState,
        engineState: current.engineState,
      })
      .returning({ id: fileVersions.id });
    await syncContentAssets(
      tx,
      current.fileId,
      current.projection,
      version!.id,
      actorId,
    );
    return version!.id;
  }
  private async persist(
    fileId: string,
    state: Buffer,
    update: Buffer,
    context?: Context,
    contributors: Context[] = [],
  ): Promise<Checkpoint> {
    return this.database.db.transaction(async (tx) => {
      const [file] = await tx
        .select({ spaceId: files.spaceId })
        .from(files)
        .where(eq(files.id, fileId));
      if (!file) throw new AppError("NOT_FOUND", "文件不存在", 404);
      await lockSpace(tx, file.spaceId);
      const [current] = await tx
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId))
        .for("update");
      if (!current) throw new AppError("NOT_FOUND", "文档内容不存在", 404);
      if (current.epoch !== this.epochs.get(fileId))
        throw new AppError("EPOCH_CONFLICT", "文档版本已切换", 409);
      if (current.documentState?.equals(state))
        return {
          fileId,
          revision: current.revision,
          epoch: current.epoch,
          savedAt: current.updatedAt.toISOString(),
        };
      const identities = new Map(
        contributors.map((identity) => [identity.sessionId, identity]),
      );
      if (context?.userId) identities.set(context.sessionId, context);
      for (const identity of identities.values()) {
        if (identity.epoch !== current.epoch)
          throw new AppError("EPOCH_CONFLICT", "文档版本已切换", 409);
        await requireFileAccess(tx, identity.userId, fileId, {
          permission: "edit",
        });
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
              eq(appUserSessions.userId, identity.userId),
              isNull(appUserSessions.revokedAt),
              gt(appUserSessions.expiresAt, new Date()),
            ),
          )
          .for("share");
        if (!session)
          throw new AppError("SESSION_EXPIRED", "登录会话已失效", 401);
      }
      const copy = new Y.Doc();
      let projection: JSONContent;
      try {
        Y.applyUpdate(copy, state);
        projection = documentProjection(copy);
        this.checkProjection(projection);
        if (current.documentState) {
          const previous = new Y.Doc();
          try {
            Y.applyUpdate(previous, current.documentState);
            // 相同 CRDT 状态可能因 GC/编码表示不同而字节不等，不能虚增业务修订。
            if (Y.equalSnapshots(Y.snapshot(copy), Y.snapshot(previous)))
              return {
                fileId,
                revision: current.revision,
                epoch: current.epoch,
                savedAt: current.updatedAt.toISOString(),
              };
          } finally {
            previous.destroy();
          }
        }
      } finally {
        copy.destroy();
      }
      const revision = current.revision + 1;
      const now = new Date();
      await tx
        .insert(documentUpdates)
        .values({ fileId, epoch: current.epoch, revision, update });
      const [saved] = await tx
        .update(fileContents)
        .set({
          documentState: state,
          projection: projection as Record<string, unknown>,
          projectionRevision: revision,
          revision,
          updatedAt: now,
        })
        .where(eq(fileContents.fileId, fileId))
        .returning();
      await syncContentAssets(
        tx,
        fileId,
        saved!.projection,
        undefined,
        context?.userId,
      );
      await this.compactUpdates(tx, saved!);
      const [last] = await tx
        .select({ createdAt: fileVersions.createdAt })
        .from(fileVersions)
        .where(eq(fileVersions.fileId, fileId))
        .orderBy(desc(fileVersions.createdAt))
        .limit(1);
      if (!last || now.getTime() - last.createdAt.getTime() >= 5 * 60000)
        await this.version(tx, saved!, "auto", context?.userId);
      return {
        fileId,
        revision,
        epoch: current.epoch,
        savedAt: now.toISOString(),
      };
    });
  }
  private async compactUpdates(
    tx: Transaction,
    checkpoint: typeof fileContents.$inferSelect,
  ) {
    if (
      !checkpoint.documentState ||
      checkpoint.projectionRevision !== checkpoint.revision
    )
      throw new AppError(
        "CHECKPOINT_INVALID",
        "文档恢复检查点尚未完整持久化",
        409,
      );
    // 完整 Yjs 状态与其修订在同一事务内落盘后，才删除覆盖的旧日志。
    // 保留检查点所在修订及任何更高修订，事务失败会同时回滚检查点和删除。
    await tx
      .delete(documentUpdates)
      .where(
        and(
          eq(documentUpdates.fileId, checkpoint.fileId),
          or(
            lt(documentUpdates.epoch, checkpoint.epoch),
            and(
              eq(documentUpdates.epoch, checkpoint.epoch),
              lt(documentUpdates.revision, checkpoint.revision),
            ),
          ),
        ),
      );
  }
  async persistBarrier(
    fileId: string,
    snapshot?: number[],
  ): Promise<Checkpoint> {
    const document = this.server.documents.get(fileId);
    if (document) {
      const state = Buffer.from(Y.encodeStateAsUpdate(document));
      const storedSnapshot = Y.snapshot(document);
      const pending = this.pendingSaves.get(fileId);
      if (pending) {
        clearTimeout(pending.deadline);
        this.pendingSaves.delete(fileId);
      }
      const active =
        this.activeSaves.get(fileId) ?? new Set<PendingDocumentSave>();
      if (pending) {
        active.add(pending);
        this.activeSaves.set(fileId, active);
      }
      const contributors = [...active].flatMap((batch) => [
        ...batch.contexts.values(),
      ]);
      const context = this.contexts.get(fileId);
      let result: Checkpoint;
      try {
        result = await this.enqueue(fileId, () =>
          this.persist(
            fileId,
            state,
            Buffer.from(pending?.update ?? state),
            context,
            contributors,
          ),
        );
        // ACK 对应捕获时的快照；写入过程中出现的新更新由下一批保存，不冒充已落库。
        document.broadcastStateless(
          JSON.stringify({
            type: "saved",
            ...result,
            snapshot: Array.from(Y.encodeSnapshot(storedSnapshot)),
          }),
        );
      } catch (error) {
        document.broadcastStateless(
          JSON.stringify({
            type: "error",
            message: "服务器保存失败，请保留页面和本地草稿",
          }),
        );
        const terminal =
          error instanceof AppError &&
          [401, 403, 404, 409].includes(error.statusCode);
        if (terminal && this.server.documents.get(fileId) === document) {
          // 权限或世代失效不能靠重试恢复；隔离未提交的共享状态，客户端保留草稿后从权威内容重连。
          const newer = this.pendingSaves.get(fileId);
          if (newer) clearTimeout(newer.deadline);
          this.pendingSaves.delete(fileId);
          for (const socket of this.sockets.values()) {
            if (socket.context.fileId === fileId)
              socket.close(
                4009,
                "保存权限或版本已变化，请保留本地草稿后重新加载",
              );
          }
          this.server.documents.delete(fileId);
          this.contexts.delete(fileId);
          document.destroy();
        }
        if (
          pending &&
          !terminal &&
          this.server.documents.get(fileId) === document
        ) {
          const newer = this.pendingSaves.get(fileId);
          if (newer) {
            newer.update = Y.mergeUpdates([pending.update, newer.update]);
            for (const [id, identity] of pending.contexts)
              if (!newer.contexts.has(id)) newer.contexts.set(id, identity);
          } else if (!this.closing) {
            pending.deadline = this.saveDeadline(fileId);
            this.pendingSaves.set(fileId, pending);
          }
        }
        throw error;
      } finally {
        if (pending) active.delete(pending);
        if (!active.size && this.activeSaves.get(fileId) === active)
          this.activeSaves.delete(fileId);
      }
      if (
        snapshot &&
        !snapshotContains(
          Y.decodeSnapshot(Uint8Array.from(snapshot)),
          storedSnapshot,
        )
      )
        throw new AppError(
          "CHECKPOINT_PENDING",
          "指定更新尚未全部持久化，请稍后重试",
          409,
        );
      return result;
    }
    if (this.queues.has(fileId)) await this.queues.get(fileId)?.catch(() => {});
    const [current] = await this.database.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    if (!current) throw new AppError("NOT_FOUND", "内容不存在", 404);
    if (snapshot) {
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, current.documentState!);
        if (
          !snapshotContains(
            Y.decodeSnapshot(Uint8Array.from(snapshot)),
            Y.snapshot(doc),
          )
        )
          throw new AppError(
            "CHECKPOINT_PENDING",
            "指定更新尚未全部持久化",
            409,
          );
      } finally {
        doc.destroy();
      }
    }
    return {
      fileId,
      revision: current.revision,
      epoch: current.epoch,
      savedAt: current.updatedAt.toISOString(),
    };
  }
  async checkpoint(
    userId: string,
    fileId: string,
    options: { snapshot?: number[]; manual?: boolean; note?: string } = {},
  ) {
    await requireFileAccess(this.database, userId, fileId, {
      permission: "edit",
    });
    const saved = await this.persistBarrier(fileId, options.snapshot);
    if (!options.manual) return saved;
    const latest = await this.database.db.transaction(async (tx) => {
      await requireFileAccess(tx, userId, fileId, { permission: "edit" });
      const [current] = await tx
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, fileId))
        .for("update");
      const versionId = await this.version(
        tx,
        current!,
        "manual",
        userId,
        options.note ?? "",
      );
      return {
        fileId,
        versionId,
        revision: current!.revision,
        epoch: current!.epoch,
        savedAt: current!.updatedAt.toISOString(),
      };
    });
    return latest;
  }
  async replaceDocument(fileId: string, userId: string, input: Replacement) {
    const normalized = normalizeDocument(input.projection);
    this.checkProjection(normalized);
    const doc = createDocumentState(normalized);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    doc.destroy();
    if (this.paused.has(fileId))
      throw new AppError("CONTENT_CONFLICT", "文档正在处理其他替换命令", 409);
    this.paused.add(fileId);
    try {
      await this.persistBarrier(fileId);
      const result = await this.enqueue(fileId, async () =>
        this.database.db.transaction(async (tx) => {
          const file = await requireFileAccess(tx, userId, fileId, {
            permission: "edit",
          });
          await lockSpace(tx, file.spaceId);
          await requireFileAccess(tx, userId, fileId, { permission: "edit" });
          const [current] = await tx
            .select()
            .from(fileContents)
            .where(eq(fileContents.fileId, fileId))
            .for("update");
          if (!current || current.engine !== "yjs")
            throw new AppError("FILE_KIND_INVALID", "仅支持文档替换", 400);
          if (
            current.revision !== input.expectedRevision ||
            current.epoch !== input.expectedEpoch
          )
            throw new AppError(
              "CONTENT_CONFLICT",
              "文档已变化，请重新读取后提交",
              409,
              {
                currentRevision: current.revision,
                currentEpoch: current.epoch,
              },
            );
          await this.version(tx, current, "before-replace", userId);
          const revision = current.revision + 1,
            epoch = current.epoch + 1;
          const [saved] = await tx
            .update(fileContents)
            .set({
              projection: normalized as Record<string, unknown>,
              projectionRevision: revision,
              documentState: state,
              revision,
              epoch,
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
          await this.compactUpdates(tx, saved!);
          const versionId = await this.version(
            tx,
            saved!,
            input.source,
            userId,
            input.note ?? "",
            true,
          );
          return {
            fileId,
            revision,
            epoch,
            savedAt: saved!.updatedAt.toISOString(),
            versionId,
          };
        }),
      );
      this.server.documents
        .get(fileId)
        ?.broadcastStateless(
          JSON.stringify({ type: "epoch-changed", epoch: result.epoch }),
        );
      this.revokeFiles([fileId]);
      const old = this.server.documents.get(fileId);
      if (old) {
        this.server.documents.delete(fileId);
        old.destroy();
      }
      this.epochs.delete(fileId);
      this.contexts.delete(fileId);
      return result;
    } finally {
      this.paused.delete(fileId);
    }
  }
  /** AI局部命令先在隔离候选Y.Doc验证，落盘后广播同epoch增量。 */
  async mutateDocumentAtomic(
    fileId: string,
    userId: string,
    input: {
      expectedRevision: number;
      expectedEpoch: number;
      operations: DocumentCommand[];
      beforeTransaction?: (tx: Transaction) => Promise<void>;
      authorize?: (tx: Transaction) => Promise<void>;
      onCommitted?: (
        tx: Transaction,
        result: DocumentMutationResult,
      ) => Promise<void>;
    },
  ) {
    if (this.paused.has(fileId))
      throw new AppError("CONTENT_CONFLICT", "文档正在处理其他命令", 409);
    this.paused.add(fileId);
    try {
      await this.persistBarrier(fileId);
      let delta: Uint8Array | undefined;
      const result = await this.enqueue(fileId, async () =>
        this.database.db.transaction(async (tx) => {
          await input.beforeTransaction?.(tx);
          const file = await requireFileAccess(tx, userId, fileId, {
            permission: "edit",
          });
          await lockSpace(tx, file.spaceId);
          await requireFileAccess(tx, userId, fileId, { permission: "edit" });
          await input.authorize?.(tx);
          const [current] = await tx
            .select()
            .from(fileContents)
            .where(eq(fileContents.fileId, fileId))
            .for("update");
          if (!current || current.engine !== "yjs" || !current.documentState)
            throw new AppError("FILE_KIND_INVALID", "仅支持文档局部命令", 400);
          if (
            current.revision !== input.expectedRevision ||
            current.epoch !== input.expectedEpoch
          )
            throw new AppError(
              "CONTENT_CONFLICT",
              "文档已变化，请重新读取后提交",
              409,
              {
                currentRevision: current.revision,
                currentEpoch: current.epoch,
              },
            );
          const candidate = new Y.Doc();
          let projection: JSONContent;
          let touched: string[];
          let state: Buffer;
          try {
            Y.applyUpdate(candidate, current.documentState);
            const vector = Y.encodeStateVector(candidate);
            touched = applyDocumentCommands(candidate, input.operations);
            projection = documentProjection(candidate);
            this.checkProjection(projection);
            state = Buffer.from(Y.encodeStateAsUpdate(candidate));
            delta = Y.encodeStateAsUpdate(candidate, vector);
          } finally {
            candidate.destroy();
          }
          const revision = current.revision + 1;
          await tx.insert(documentUpdates).values({
            fileId,
            epoch: current.epoch,
            revision,
            update: Buffer.from(delta!),
          });
          const [saved] = await tx
            .update(fileContents)
            .set({
              documentState: state,
              projection: projection as Record<string, unknown>,
              revision,
              projectionRevision: revision,
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
          await this.compactUpdates(tx, saved!);
          const versionId = await this.version(
            tx,
            saved!,
            "ai",
            userId,
            "",
            true,
          );
          const result: DocumentMutationResult = {
            fileId,
            revision,
            epoch: current.epoch,
            savedAt: saved!.updatedAt.toISOString(),
            versionId,
            touchedBlockIds: touched,
          };
          await input.onCommitted?.(tx, result);
          return result;
        }),
      );
      const live = this.server.documents.get(fileId);
      if (live && delta) {
        Y.applyUpdate(live, delta, committedAiOrigin);
        live.broadcastStateless(
          JSON.stringify({
            type: "saved",
            ...result,
            snapshot: Array.from(Y.encodeSnapshot(Y.snapshot(live))),
          }),
        );
      }
      return result;
    } finally {
      this.paused.delete(fileId);
    }
  }
  async revalidateFilePermissions(fileId: string) {
    for (const [key, socket] of [...this.sockets]) {
      if (socket.context.fileId !== fileId || !socket.context.userId) continue;
      try {
        await this.validate(socket.context);
      } catch {
        socket.close(4003, "文档编辑权限已撤销");
        this.sockets.delete(key);
      }
    }
  }
  revokeFiles(fileIds: string[]) {
    const set = new Set(fileIds);
    for (const [key, socket] of this.sockets)
      if (set.has(socket.context.fileId)) {
        socket.close(4009, "文件状态或版本已变化，请重新加载");
        this.sockets.delete(key);
      }
    for (const [key, ticket] of this.tickets)
      if (set.has(ticket.fileId)) this.tickets.delete(key);
  }
  async revokeUser(userId: string, spaceId?: string) {
    for (const [key, socket] of this.sockets)
      if (socket.context.userId === userId) {
        if (spaceId) {
          try {
            const file = await this.database.db
              .select({ spaceId: files.spaceId })
              .from(files)
              .where(eq(files.id, socket.context.fileId));
            if (file[0]?.spaceId !== spaceId) continue;
          } catch {}
        }
        socket.close(4003, "空间访问权限已撤销");
        this.sockets.delete(key);
      }
    for (const [key, ticket] of this.tickets)
      if (ticket.userId === userId) this.tickets.delete(key);
  }
  revokeSession(sessionId: string) {
    for (const [key, socket] of this.sockets)
      if (socket.context.sessionId === sessionId) {
        socket.close(4003, "登录会话已撤销");
        this.sockets.delete(key);
      }
    for (const [key, ticket] of this.tickets)
      if (ticket.sessionId === sessionId) this.tickets.delete(key);
  }
  detach(socketId: string) {
    this.sockets.delete(socketId);
  }
  attach(
    fileId: string,
    socketId: string,
    close: (code: number, reason: string) => void,
  ) {
    this.sockets.set(socketId, {
      context: { fileId, userId: "", sessionId: "", epoch: 0, socketId },
      close,
    });
  }
  async close() {
    this.closing = true;
    clearInterval(this.historyTimer);
    try {
      for (const id of this.server.documents.keys())
        await this.persistBarrier(id);
    } finally {
      for (const pending of this.pendingSaves.values())
        clearTimeout(pending.deadline);
      this.server.closeConnections();
      await Promise.allSettled(this.queues.values());
    }
  }
}
export async function registerDocumentRooms(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
  sheets?: SheetRooms,
) {
  if (!app.hasDecorator("websocketServer"))
    await app.register(websocket, {
      options: { maxPayload: 8 * 1024 * 1024 },
      preClose: async () => {
        for (const client of app.websocketServer.clients) client.terminate();
        await new Promise<void>((resolve, reject) =>
          app.websocketServer.close((error) =>
            error ? reject(error) : resolve(),
          ),
        );
      },
    });
  const manager = new DocumentRooms(database, config);
  app.addHook("onClose", () => manager.close());
  app.post<{
    Params: { fileId: string };
    Body: { schemaVersion: number; editSessionId?: string };
  }>(
    "/api/app/files/:fileId/collaboration-ticket",
    {
      config: { auth: true, authScope: "app" },
      schema: {
        tags: ["文档协作"],
        summary: "签发单文件短期协作凭证",
        description:
          "当前账号空间成员资格、文档或表格类型及格式兼容校验；凭证一分钟有效且单次使用，只能通过协作认证消息传递。",
        params: Type.Object({ fileId: id }),
        body: Type.Object(
          {
            schemaVersion: Type.Integer({
              minimum: 1,
              maximum: 100,
              description: "客户端内容格式版本",
            }),
            editSessionId: Type.Optional(
              Type.String({
                pattern: "^[a-zA-Z0-9_-]{16,100}$",
                description: "表格编辑会话标识，重连沿用，其他新标签页重新生成",
              }),
            ),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            ticket: Type.String({ description: "协作认证凭证" }),
            documentName: id,
            editSessionId: Type.Optional(
              Type.String({ description: "表格编辑会话标识" }),
            ),
            epoch: Type.Integer({ description: "内容世代" }),
            revision: Type.Integer({ description: "持久化修订" }),
            schemaVersion: Type.Integer({ description: "格式版本" }),
            protocolVersion: Type.Integer({ description: "协作协议版本" }),
            maxSessions: Type.Integer({ description: "同时编辑会话上限" }),
            expiresAt: Type.String({ description: "凭证有效期" }),
            url: Type.String({ description: "协作连接路径，不包含凭证" }),
          }),
          ...errors,
        },
      },
    },
    async (request) => {
      const file = await requireFileAccess(
        database,
        request.appIdentity!.id,
        request.params.fileId,
        { permission: "edit" },
      );
      if (file.kind === "sheet" && sheets)
        return sheets.issueTicket(
          request.appIdentity!.id,
          request.appIdentity!.sessionId,
          file.id,
          request.body.schemaVersion,
          request.body.editSessionId,
        );
      return manager.issueTicket(
        request.appIdentity!.id,
        request.appIdentity!.sessionId,
        file.id,
        request.body.schemaVersion,
      );
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/app/collaboration/documents/:id",
    {
      websocket: true,
      config: { auth: false },
      schema: {
        tags: ["文档协作"],
        summary: "连接文档协作房间",
        description:
          "WebSocket使用单文件短期凭证认证；逐次消息重新校验登录及空间权限，不接受URL凭证。",
        params: Type.Object({ id }),
        response: { 200: Type.Object({}) },
      },
    },
    (socket, request) => {
      const origin = request.headers.origin;
      if (origin && !loadMinmdConfig(config).allowedOrigins.includes(origin)) {
        socket.close(4003, "协作来源不合法");
        return;
      }
      if (request.url.includes("?")) {
        socket.close(4003, "协作连接不得携带URL参数");
        return;
      }
      const socketId = crypto.randomUUID();
      manager.attach(request.params.id, socketId, (code, reason) =>
        socket.close(code, reason),
      );
      const connection = manager.server.handleConnection(
        socket,
        new Request(`http://127.0.0.1${request.url}`, {
          headers: origin ? { origin } : {},
        }),
        {
          fileId: request.params.id,
          socketId,
          userId: "",
          sessionId: "",
          epoch: 0,
        },
      );
      socket.on("error", () => {});
      let messageWindow = { startedAt: Date.now(), count: 0 };
      socket.on("message", (raw, binary) => {
        // 在进入 Hocuspocus 异步处理前计数，避免慢鉴权将突发流量摊开。
        const now = Date.now();
        if (now - messageWindow.startedAt >= 1000)
          messageWindow = { startedAt: now, count: 0 };
        if (++messageWindow.count > manager.messagesPerSecond) {
          socket.close(4029, "协作消息过于频繁，请稍后重连");
          return;
        }
        if (!binary) {
          socket.close(4003, "协作消息格式错误");
          return;
        }
        connection.handleMessage(
          Array.isArray(raw)
            ? Buffer.concat(raw)
            : raw instanceof ArrayBuffer
              ? new Uint8Array(raw)
              : raw,
        );
      });
      socket.once("close", (code, reason) => {
        manager.detach(socketId);
        connection.handleClose({ code, reason: reason.toString() });
      });
    },
  );
  return manager;
}
