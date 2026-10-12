import axios from "axios";
import { collaborationUrl } from "@/utils/collaborationUrl";
import { snapshotConfirmed } from "./collaborationState";
import { useEffect, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import * as Y from "yjs";
import { documentApi, type DocumentTicket } from "@/api/documents";
import { errorMessage } from "@/http";
import { useAuth } from "@/store/auth";
import type { Entry } from "@/store/workspace";
import {
  draftKey,
  readDrafts,
  saveDraft,
  removeDraft,
  type RecoveryDraft,
} from "./drafts";
export type DocumentSession = {
  document: Y.Doc;
  provider: HocuspocusProvider;
  epoch: number;
  revision: number;
  loaded: boolean;
  pending: boolean;
  userName: string;
  scope: Pick<
    RecoveryDraft,
    "userId" | "spaceId" | "fileId" | "sessionId" | "epoch"
  >;
};
export type CollaborationView = {
  ready: boolean;
  connected: boolean;
  synced: boolean;
  saved: boolean;
  notice: string;
  count: number;
  limit: number;
  revision: number;
  epoch: number;
};
const initial: CollaborationView = {
  ready: false,
  connected: false,
  synced: false,
  saved: false,
  notice: "正在连接文档…",
  count: 0,
  limit: 10,
  revision: 0,
  epoch: 0,
};
export function useDocumentCollaboration(file: Entry) {
  const user = useAuth((state) => state.user);
  const [session, setSession] = useState<DocumentSession | null>(null);
  const sessionRef = useRef<DocumentSession | null>(null);
  const [view, setView] = useState(initial);
  const [attempt, setAttempt] = useState(0);
  const [drafts, setDrafts] = useState<RecoveryDraft[]>([]);
  const restart = () => setAttempt((value) => value + 1);
  useEffect(() => {
    if (!user) return;
    let stopped = false;
    let current: DocumentSession | null = null;
    let websocket: HocuspocusProviderWebsocket | null = null;
    let ready = false;
    let durable: { epoch?: number; snapshot?: number[] } | null = null;
    setSession(null);
    sessionRef.current = null;
    setView(initial);
    void readDrafts(user.id, file.space, file.id)
      .then((items) => {
        if (!stopped) setDrafts(items);
      })
      .catch(() => {});
    const connect = async () => {
      const ticket = await documentApi.ticket(file.id);
      if (stopped) return;
      const document = new Y.Doc();
      let firstTicket: DocumentTicket | null = ticket;
      websocket = new HocuspocusProviderWebsocket({
        url: collaborationUrl(ticket.url),
        autoConnect: false,
      });
      const provider = new HocuspocusProvider({
        name: ticket.documentName,
        document,
        websocketProvider: websocket,
        token: async () => {
          const next = firstTicket ?? (await documentApi.ticket(file.id));
          firstTicket = null;
          if (next.epoch !== ticket.epoch) {
            if (!stopped) restart();
            throw new Error("文档版本已更新，正在重新打开");
          }
          return next.ticket;
        },
      });
      current = {
        document,
        provider,
        epoch: ticket.epoch,
        revision: ticket.revision,
        loaded: false,
        pending: false,
        userName: user.nickname || user.account,
        scope: {
          userId: user.id,
          spaceId: file.space,
          fileId: file.id,
          sessionId: crypto.randomUUID(),
          epoch: ticket.epoch,
        },
      };
      sessionRef.current = current;
      setSession(current);
      setView((value) => ({
        ...value,
        epoch: ticket.epoch,
        revision: ticket.revision,
        limit: ticket.maxSessions,
      }));
      const update = (patch: Partial<CollaborationView>) => {
        if (!stopped) setView((value) => ({ ...value, ...patch }));
      };
      provider.on("status", ({ status }: { status: string }) => {
        const connected = status === "connected";
        if (!connected) ready = false;
        update({
          connected,
          notice: connected
            ? current?.loaded
              ? ""
              : "正在同步文档…"
            : status === "connecting"
              ? current?.loaded
                ? "正在重新连接文档…"
                : "正在连接文档…"
              : "连接已断开，正在重新验证身份并重连",
          ...(!connected
            ? {
                ready: false,
                synced: false,
              }
            : {}),
        });
      });
      provider.on("synced", ({ state }: { state: boolean }) => {
        if (state && current) {
          current.loaded = true;
          provider.sendStateless("ready");
        }
        update({ synced: state, ready: state && ready });
      });
      provider.on("unsyncedChanges", ({ number }: { number: number }) => {
        if (number > 0)
          update({
            synced: false,
            saved: durable
              ? snapshotConfirmed(document, ticket.epoch, durable)
              : false,
          });
        else update({ synced: true });
      });
      provider.on("authenticationFailed", ({ reason }: { reason?: string }) => {
        websocket?.disconnect();
        update({
          ready: false,
          connected: false,
          notice: reason || "无法访问文档，请重新登录或检查空间权限",
        });
      });
      provider.on("close", ({ event }: { event: CloseEvent }) => {
        if ([4003, 4008, 4009, 4403].includes(event.code)) {
          websocket?.disconnect();
          update({
            ready: false,
            connected: false,
            notice: event.reason || "协作会话已关闭",
          });
          if (event.code === 4009 && !stopped) restart();
        }
      });
      provider.on("stateless", ({ payload }: { payload: string }) => {
        let packet: {
          type: string;
          epoch?: number;
          revision?: number;
          snapshot?: number[];
          count?: number;
          limit?: number;
          message?: string;
        };
        try {
          packet = JSON.parse(payload);
        } catch {
          return;
        }
        if (!current || stopped) return;
        if (packet.type === "ready") {
          current.revision = Math.max(current.revision, packet.revision ?? 0);
          ready = true;
          update({
            ready: provider.synced,
            notice: "",
            epoch: packet.epoch ?? current.epoch,
            revision: packet.revision ?? current.revision,
          });
        } else if (packet.type === "members")
          update({ count: packet.count ?? 0, limit: packet.limit ?? 10 });
        else if (packet.type === "saved") {
          if (
            packet.revision !== undefined &&
            packet.revision < current.revision
          )
            return;
          durable = packet;
          const saved = snapshotConfirmed(document, current.epoch, packet);
          current.revision = packet.revision ?? current.revision;
          if (saved && current.pending) {
            current.pending = false;
            void removeDraft(current.scope).catch(() => {});
          }
          update({
            saved,
            revision: current.revision,
            ...(saved ? { notice: "" } : {}),
          });
        } else if (packet.type === "epoch-changed") restart();
        else if (packet.type === "error")
          update({
            saved: false,
            notice: packet.message || "文档保存失败，请备份未确认内容",
          });
      });
      provider.attach();
      void websocket.connect();
    };
    void connect().catch((error: unknown) => {
      if (!stopped)
        setView((value) => ({ ...value, notice: errorMessage(error) }));
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (current?.pending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      stopped = true;
      window.removeEventListener("beforeunload", beforeUnload);
      current?.provider.destroy();
      websocket?.destroy();
      current?.document.destroy();
      sessionRef.current = null;
    };
  }, [file.id, file.space, user?.id, attempt]);
  const recordDraft = (projection: JSONContent) => {
    const current = sessionRef.current;
    if (!current) return;
    current.pending = true;
    setView((value) => ({ ...value, saved: false }));
    void saveDraft({
      ...current.scope,
      projection,
      updatedAt: new Date().toISOString(),
    }).catch(() =>
      setView((value) => ({
        ...value,
        notice: "恢复草稿无法保存，请及时导出备份",
      })),
    );
  };
  const checkpoint = async (note?: string) => {
    const current = sessionRef.current;
    if (!current || !view.ready || !view.connected)
      throw new Error("文档尚未连接，暂不能创建版本");
    const snapshot = Array.from(Y.encodeSnapshot(Y.snapshot(current.document)));
    let result: Awaited<ReturnType<typeof documentApi.checkpoint>> | undefined;
    for (let retry = 0; retry < 32; retry++) {
      if (sessionRef.current !== current)
        throw new Error("文档版本已变化，请重新保存");
      try {
        result = await documentApi.checkpoint(file.id, snapshot, note);
        break;
      } catch (error) {
        if (
          !axios.isAxiosError(error) ||
          error.response?.status !== 409 ||
          retry === 31
        )
          throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!result) throw new Error("保存超时，请检查连接后重试");
    current.revision = result.revision;
    setView((value) => ({ ...value, revision: result.revision }));
    return result;
  };
  return {
    session,
    view,
    restart,
    recordDraft,
    checkpoint,
    drafts,
    dismissDraft: async (draft: RecoveryDraft) => {
      await removeDraft(draft);
      setDrafts((items) =>
        items.filter((item) => draftKey(item) !== draftKey(draft)),
      );
    },
  };
}
