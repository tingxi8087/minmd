import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import Spreadsheet from "../src/views/Spreadsheet";
import type { Entry } from "../src/store/workspace";
const { sync } = vi.hoisted(() => ({
  sync: {
    state: "saved",
    connected: true,
    editable: true,
    notice: "",
    pendingCount: 0,
    hasRecovery: false,
    recoveryCopies: [] as { key: string; draft: { epoch: number } }[],
    members: { count: 1, limit: 10 },
    data: [],
    generation: 0,
    checkpoint: () => Promise.resolve(),
    undo: () => Promise.resolve(),
  },
}));
vi.mock("../src/views/Spreadsheet/useSheetCollaboration", () => ({
  useSheetCollaboration: () => sync,
}));
vi.mock("@fortune-sheet/react", async () => {
  const { forwardRef } = await import("react");
  return { Workbook: forwardRef(() => <div data-testid="workbook" />) };
});
vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ state: "unblocked" }),
}));
vi.mock("antd", () => ({
  App: { useApp: () => ({ message: {}, modal: {} }) },
  Dropdown: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/TooltipButton", () => ({
  default: ({
    children,
    tooltip: _tooltip,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tooltip?: string }) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/FileDialogs", () => ({ default: () => null }));
vi.mock("../src/views/Spreadsheet/SheetHistory", () => ({
  default: () => null,
}));
it.each([false, true])(
  "正常同步和临时恢复缓存不插入状态行，断线和遗留恢复副本仍提供操作（小屏 %s）",
  async (mobile) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("matchMedia", () => ({
      matches: mobile,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const host = document.createElement("div"),
      root = createRoot(host);
    const file = {
      id: "sheet-test",
      name: "测试表格",
      space: "space-test",
      kind: "sheet",
    } as Entry;
    const render = async () => {
      await act(async () => root.render(<Spreadsheet file={file} />));
    };
    try {
      Object.assign(sync, {
        state: "saved",
        connected: true,
        notice: "",
        pendingCount: 0,
        hasRecovery: false,
        recoveryCopies: [],
      });
      await render();
      expect(host.querySelector('[role="status"]')).toBeNull();
      Object.assign(sync, {
        state: "saving",
        pendingCount: 1,
        hasRecovery: true,
        recoveryCopies: [{ key: "pending", draft: { epoch: 1 } }],
      });
      await render();
      expect(host.querySelector('[role="status"]')).toBeNull();
      Object.assign(sync, {
        state: "saved",
        pendingCount: 0,
        hasRecovery: false,
        recoveryCopies: [],
      });
      await render();
      expect(host.querySelector('[role="status"]')).toBeNull();
      Object.assign(sync, {
        state: "disconnected",
        connected: false,
        hasRecovery: true,
        recoveryCopies: [{ key: "pending", draft: { epoch: 1 } }],
      });
      await render();
      expect(host.querySelector('[role="status"]')?.textContent).toContain(
        "重新连接",
      );
      expect(host.querySelector('[role="status"]')?.textContent).toContain(
        "下载恢复副本",
      );
      Object.assign(sync, { state: "saved", connected: true, pendingCount: 0 });
      await render();
      expect(host.querySelector('[role="status"]')?.textContent).toContain(
        "本地恢复副本已保留",
      );
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  },
);
