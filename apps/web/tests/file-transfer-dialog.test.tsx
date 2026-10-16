import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import FileTransferDialog from "../src/components/FileTransferDialog";
import {
  fileTransfersApi,
  type TransferStatus,
} from "../src/api/fileTransfers";
import { useAuth } from "../src/store/auth";
import { useWorkspace } from "../src/store/workspace";
vi.mock("antd", () => ({
  App: { useApp: () => ({ message: { success: vi.fn() } }) },
  Modal: ({
    children,
    title,
    onCancel,
    closable,
  }: {
    children: ReactNode;
    title: string;
    onCancel: () => void;
    closable: boolean;
  }) => (
    <section role="dialog" aria-label={title}>
      {closable && <button aria-label="关闭弹窗" onClick={onCancel} />}{" "}
      {children}
    </section>
  ),
  Progress: ({ percent }: { percent: number }) => <span>{percent}%</span>,
}));
const ready = (overrides: Partial<TransferStatus> = {}): TransferStatus => ({
  id: "batch",
  operation: "export",
  status: "ready",
  done: 1,
  total: 1,
  expiresAt: new Date(Date.now() + 100000).toISOString(),
  filename: "文档.minmd.zip",
  mode: "complete",
  fileCount: 1,
  assetCount: 1,
  fileIds: [],
  error: null,
  ...overrides,
});
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:export"),
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  useWorkspace.setState({ space: "space" });
  vi.spyOn(fileTransfersApi, "cancel").mockResolvedValue({ ok: true });
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const button = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text,
  )!;
it("单文档默认完整格式，等待当前输入确认后才创建导出，Markdown 选择传到实际请求", async () => {
  let release!: () => void;
  const beforeExport = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const start = vi.spyOn(fileTransfersApi, "export").mockResolvedValue(ready());
  const download = vi
    .spyOn(fileTransfersApi, "download")
    .mockResolvedValue(new Blob(["zip"]));
  await act(async () =>
    root.render(
      <FileTransferDialog
        action={{
          type: "export",
          spaceId: "space",
          ids: ["doc"],
          single: true,
          beforeExport,
        }}
        close={() => {}}
      />,
    ),
  );
  expect(
    host.querySelector('[role="radio"][aria-checked="true"]')!.textContent,
  ).toContain("完整格式");
  await act(async () => button("导出文件").click());
  expect(beforeExport).toHaveBeenCalledOnce();
  expect(start).not.toHaveBeenCalled();
  await act(async () => release());
  expect(start).toHaveBeenCalledWith(
    "space",
    ["doc"],
    "complete",
    true,
    expect.any(AbortSignal),
  );
  expect(download).toHaveBeenCalledOnce();
  await act(async () => {
    const first = host.querySelector<HTMLButtonElement>('[role="radio"]')!;
    first.focus();
    first.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
  await act(async () => button("导出文件").click());
  await act(async () => release());
  expect(start.mock.calls[1]![2]).toBe("markdown");
});
it("上传校验成功只显示摘要，用户确认后才提交；成功刷新目标目录", async () => {
  const start = vi
    .spyOn(fileTransfersApi, "import")
    .mockResolvedValue(
      ready({ operation: "import", status: "waiting-upload" }),
    );
  vi.spyOn(fileTransfersApi, "upload").mockResolvedValue(
    ready({ operation: "import" }),
  );
  const commit = vi
    .spyOn(fileTransfersApi, "commit")
    .mockResolvedValue(
      ready({ operation: "import", status: "completed", fileIds: ["new-doc"] }),
    );
  const refreshed = vi.fn(),
    close = vi.fn();
  await act(async () =>
    root.render(
      <FileTransferDialog
        action={{
          type: "import",
          spaceId: "space",
          file: new File(["zip"], "内容.minmd.zip"),
          target: { parentId: "folder", replaceFileId: null },
        }}
        close={close}
        onImported={refreshed}
      />,
    ),
  );
  expect(start).toHaveBeenCalledWith(
    "space",
    expect.any(String),
    { parentId: "folder", replaceFileId: null },
    expect.any(AbortSignal),
  );
  expect(host.textContent).toContain("1 项 · 1 个附件");
  expect(commit).not.toHaveBeenCalled();
  expect(refreshed).not.toHaveBeenCalled();
  await act(async () => button("确认导入").click());
  expect(commit).toHaveBeenCalledOnce();
  expect(refreshed).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
it("导出保存失败保留格式弹窗，不创建任务、不下载旧内容", async () => {
  const start = vi.spyOn(fileTransfersApi, "export");
  const download = vi.spyOn(fileTransfersApi, "download");
  await act(async () =>
    root.render(
      <FileTransferDialog
        action={{
          type: "export",
          spaceId: "space",
          ids: ["doc"],
          beforeExport: async () => {
            throw Error("修改尚未保存");
          },
        }}
        close={() => {}}
      />,
    ),
  );
  await act(async () => button("导出文件").click());
  expect(host.querySelector('[role="alert"]')!.textContent).toBe(
    "修改尚未保存",
  );
  expect(start).not.toHaveBeenCalled();
  expect(download).not.toHaveBeenCalled();
  expect(button("导出文件").disabled).toBe(false);
});
it("账号或空间切换中止待完成的上传，不借用新身份提交或刷新", async () => {
  vi.spyOn(fileTransfersApi, "import").mockResolvedValue(
    ready({ operation: "import", status: "waiting-upload" }),
  );
  let release!: (value: TransferStatus) => void;
  const upload = vi.spyOn(fileTransfersApi, "upload").mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const commit = vi.spyOn(fileTransfersApi, "commit");
  const close = vi.fn(),
    refreshed = vi.fn();
  await act(async () =>
    root.render(
      <FileTransferDialog
        action={{
          type: "import",
          spaceId: "space",
          file: new File(["zip"], "archive.zip"),
          target: { parentId: null, replaceFileId: null },
        }}
        close={close}
        onImported={refreshed}
      />,
    ),
  );
  const signal = upload.mock.calls[0]![2]!;
  await act(async () => useWorkspace.setState({ space: "another-space" }));
  expect(signal.aborted).toBe(true);
  await act(async () => release(ready({ operation: "import" })));
  expect(commit).not.toHaveBeenCalled();
  expect(refreshed).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
});
