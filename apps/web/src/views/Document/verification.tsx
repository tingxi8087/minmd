import { useEffect, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import * as Y from "yjs";
import type { Entry } from "@/store/workspace";

export type DocumentSession = {
  document: Y.Doc;
  provider: HocuspocusProvider;
  seed: JSONContent;
  initialize: boolean;
  seeded: boolean;
};
export type VerificationView = {
  ready: boolean;
  connected: boolean;
  count: number;
  limit: number;
  notice: string;
  saved: boolean;
};
export function useDocumentVerification(file: Entry) {
  const [session, setSession] = useState<DocumentSession | null>(null);
  const [visible, setVisible] = useState(false);
  const [view, setView] = useState<VerificationView>({
    ready: false,
    connected: false,
    count: 0,
    limit: 10,
    notice: "",
    saved: false,
  });
  const start = (seed: JSONContent) => {
    const document = new Y.Doc();
    const websocketProvider = new HocuspocusProviderWebsocket({
      url: `${import.meta.env.MINMD_SHEET_VERIFY_WS}/api/experimental/documents/${file.id}`,
      autoConnect: false,
    });
    const provider = new HocuspocusProvider({
      name: file.id,
      document,
      websocketProvider,
      token: "development-verification",
    });
    setVisible(false);
    setView({
      ready: false,
      connected: false,
      count: 0,
      limit: 10,
      notice: "正在连接文档协作验证…",
      saved: false,
    });
    setSession({ document, provider, seed, initialize: false, seeded: false });
  };
  useEffect(() => {
    if (!session) return;
    const { provider } = session;
    let initialized = false;
    provider.on("synced", ({ state }: { state: boolean }) => {
      if (state) provider.sendStateless("initialize");
    });
    provider.on("status", ({ status }: { status: string }) => {
      if (status !== "connected") initialized = false;
      setView((v) => ({
        ...v,
        connected: status === "connected",
        ready: status === "connected" && v.ready,
        notice:
          status === "connected"
            ? v.notice
            : "连接已断开，正在自动重连；未同步修改保留在当前页面",
      }));
    });
    provider.on("close", ({ event }: { event: CloseEvent }) => {
      if ([4003, 4008].includes(event.code)) {
        provider.configuration.websocketProvider.disconnect();
        setView((v) => ({
          ...v,
          ready: false,
          connected: false,
          notice: event.reason || "协作连接被拒绝",
        }));
      }
    });
    provider.on("authenticationFailed", () => {
      provider.configuration.websocketProvider.disconnect();
      setView((v) => ({ ...v, ready: false, notice: "文档协作连接校验失败" }));
    });
    provider.on("unsyncedChanges", ({ number }: { number: number }) => {
      if (number > 0) setView((v) => ({ ...v, saved: false }));
    });
    provider.on("stateless", ({ payload }: { payload: string }) => {
      const packet: {
        type: string;
        count?: number;
        limit?: number;
        message?: string;
        snapshot?: number[];
      } = JSON.parse(payload);
      if (packet.type === "initialize") {
        session.initialize = true;
        setVisible(true);
      } else if (packet.type === "ready") {
        initialized = true;
        setVisible(true);
        setView((v) => ({ ...v, ready: true, notice: "" }));
      } else if (packet.type === "members")
        setView((v) => ({
          ...v,
          count: packet.count ?? 0,
          limit: packet.limit ?? 10,
        }));
      else if (packet.type === "saved")
        setView((v) => ({
          ...v,
          saved:
            Boolean(packet.snapshot) &&
            Y.equalSnapshots(
              Y.decodeSnapshot(new Uint8Array(packet.snapshot ?? [])),
              Y.snapshot(session.document),
            ),
        }));
      else if (packet.type === "error")
        setView((v) => ({
          ...v,
          ready: false,
          saved: false,
          notice: packet.message ?? "服务器保存失败",
        }));
    });
    const retry = setInterval(() => {
      if (provider.synced && !initialized) provider.sendStateless("initialize");
    }, 2000);
    provider.attach();
    void provider.configuration.websocketProvider.connect();
    return () => {
      clearInterval(retry);
      provider.destroy();
      provider.configuration.websocketProvider.destroy();
      session.document.destroy();
    };
  }, [session]);
  return { session, view, visible, start, stop: () => setSession(null) };
}
