import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useDocumentCollaboration } from "../src/views/Document/collaboration";
import { documentApi } from "../src/api/documents";
import { useAuth } from "../src/store/auth";
import { fromRemoteFile } from "../src/store/workspace";
const transport = vi.hoisted(() => ({
  listeners: new Map<string, (value: unknown) => void>(),
}));
vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class {
    synced = false;
    on(name: string, handler: (value: unknown) => void) {
      transport.listeners.set(name, handler);
    }
    attach() {}
    destroy() {}
    sendStateless() {}
  },
  HocuspocusProviderWebsocket: class {
    connect() {
      transport.listeners.get("status")?.({ status: "connecting" });
    }
    disconnect() {}
    destroy() {}
  },
}));
vi.mock("@/views/Document/drafts", () => ({
  readDrafts: async () => [],
  saveDraft: async () => {},
  removeDraft: async () => {},
}));
it("首次 connecting 不显示断开；真实断开和鉴权失败仍显示原因", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAuth.setState({
    user: { id: "owner", account: "owner" } as NonNullable<
      ReturnType<typeof useAuth.getState>["user"]
    >,
  });
  vi.spyOn(documentApi, "ticket").mockResolvedValue({
    ticket: "ticket",
    epoch: 1,
    revision: 1,
    maxSessions: 10,
    url: "/collaboration/documents",
    documentName: "doc",
    schemaVersion: 1,
    protocolVersion: 1,
    expiresAt: "2026-10-12T23:59:59Z",
  });
  const file = fromRemoteFile({
    id: "doc",
    spaceId: "space",
    kind: "doc",
    name: "测试",
    parentId: null,
    position: 0,
    createdBy: "owner",
    visibility: "private",
    metadataRevision: 1,
    deletedBatch: null,
    deletedAt: null,
    createdAt: "",
    updatedAt: "",
  });
  const host = document.createElement("div");
  const root = createRoot(host);
  function Probe() {
    const { view } = useDocumentCollaboration(file);
    return <p>{view.notice}</p>;
  }
  try {
    await act(async () => root.render(<Probe />));
    expect(host.textContent).toBe("正在连接文档…");
    await act(async () =>
      transport.listeners.get("status")?.({ status: "connected" }),
    );
    expect(host.textContent).toBe("正在同步文档…");
    await act(async () =>
      transport.listeners.get("status")?.({ status: "disconnected" }),
    );
    expect(host.textContent).toContain("连接已断开");
    await act(async () => transport.listeners.get("synced")?.({ state: true }));
    await act(async () =>
      transport.listeners.get("status")?.({ status: "connecting" }),
    );
    expect(host.textContent).toBe("正在重新连接文档…");
    await act(async () =>
      transport.listeners.get("authenticationFailed")?.({
        reason: "你没有文档权限",
      }),
    );
    expect(host.textContent).toBe("你没有文档权限");
  } finally {
    act(() => root.unmount());
  }
});
