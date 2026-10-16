import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { filesApi } from "../src/api/files";
import FileDialogs, { type FileAction } from "../src/components/FileDialogs";
import {
  fromRemoteFile,
  useWorkspace,
  type Entry,
} from "../src/store/workspace";
import { useAuth } from "../src/store/auth";
vi.mock("@/components/ShareDialog", () => ({ default: () => null }));
vi.mock("antd", async (original) => {
  const actual = await original<typeof import("antd")>();
  return {
    ...actual,
    App: {
      useApp: () => ({
        message: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
        modal: { confirm: vi.fn() },
      }),
    },
    Modal: ({
      children,
      onOk,
      okText,
      okButtonProps,
    }: React.ComponentProps<typeof actual.Modal>) => (
      <div role="dialog">
        {children}
        <button disabled={okButtonProps?.disabled} onClick={onOk}>
          {okText}
        </button>
      </div>
    ),
  };
});
const entry = (
  id: string,
  kind: Entry["kind"],
  parent: string | null = null,
  name = id,
) =>
  fromRemoteFile({
    id,
    spaceId: "space",
    kind,
    name,
    parentId: parent,
    position: 0,
    createdBy: "user",
    visibility: "private",
    metadataRevision: 1,
    deletedBatch: null,
    deletedAt: null,
    createdAt: "",
    updatedAt: "",
  });
async function mount(
  files: Entry[],
  ids: string[],
  copy = false,
  parent: string | null = null,
) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAuth.setState({
    user: { id: "user" } as NonNullable<
      ReturnType<typeof useAuth.getState>["user"]
    >,
  });
  const loadFiles = vi.fn(async () => {}),
    close = vi.fn(),
    onCompleted = vi.fn();
  useWorkspace.setState({
    space: "space",
    files,
    filesError: "",
    spaces: [
      {
        id: "space",
        name: "测试空间",
        ownerId: "user",
        description: "",
        createdAt: "",
        updatedAt: "",
      },
    ],
    loadFiles,
  });
  const host = document.createElement("div");
  const root = createRoot(host);
  const action: FileAction = {
    type: copy ? "batch-copy" : "batch-move",
    files: files.filter((file) => ids.includes(file.id)),
    parent,
  };
  await act(async () =>
    root.render(
      <FileDialogs action={action} close={close} onCompleted={onCompleted} />,
    ),
  );
  return { host, root, loadFiles, close, onCompleted };
}
const confirm = (host: HTMLElement) =>
  Array.from(host.querySelectorAll("button")).find((button) =>
    /^(移动到此处|复制到此处|刷新文件列表)$/.test(button.textContent ?? ""),
  )!;
const search = async (host: HTMLElement, value: string) => {
  const input = host.querySelector('[aria-label="搜索目标位置"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const click = async (element: Element | null | undefined) => {
  expect(element).toBeTruthy();
  await act(async () => (element as HTMLElement).click());
};
const cleanup = (root: Root) => act(() => root.unmount());

afterEach(() => vi.restoreAllMocks());
it("批量移动父子去重、当前位置禁用，选目标后整批发送一次", async () => {
  const folder = entry("folder", "folder"),
    child = entry("child", "doc", "folder"),
    target = entry("target", "folder", null, "目标");
  const move = vi
    .spyOn(filesApi, "batchMove")
    .mockResolvedValue({ items: [], total: 1 });
  const view = await mount([folder, child, target], ["folder", "child"]);
  try {
    expect(confirm(view.host).disabled).toBe(true);
    await search(view.host, "目标");
    await click(view.host.querySelector('[aria-label="选择目标 目标"]'));
    await click(confirm(view.host));
    expect(move).toHaveBeenCalledTimes(1);
    expect(move.mock.calls[0].slice(0, 3)).toEqual([
      "space",
      ["folder"],
      "target",
    ]);
    expect(move.mock.calls[0][3]).toBeInstanceOf(AbortSignal);
    expect(view.close).toHaveBeenCalledOnce();
    expect(view.onCompleted).toHaveBeenCalledOnce();
  } finally {
    cleanup(view.root);
  }
});
it("复制可在当前目录创建，失败重试沿用同一requestId，确认刷新失败不重复创建", async () => {
  const copy = vi
    .spyOn(filesApi, "batchCopy")
    .mockRejectedValueOnce(new Error("网络中断"))
    .mockResolvedValue({ items: [], total: 1 });
  const file = entry("source", "doc");
  const view = await mount([file], [file.id], true);
  view.loadFiles
    .mockImplementationOnce(async () => {
      useWorkspace.setState({ filesError: "刷新失败" });
    })
    .mockImplementation(async () => {
      useWorkspace.setState({ filesError: "" });
    });
  try {
    expect(confirm(view.host).disabled).toBe(false);
    await click(confirm(view.host));
    expect(view.close).not.toHaveBeenCalled();
    expect(view.host.textContent).toContain("网络中断");
    await click(confirm(view.host));
    expect(copy).toHaveBeenCalledTimes(2);
    expect(copy.mock.calls[0][3]).toBe(copy.mock.calls[1][3]);
    expect(copy.mock.calls[0][3]).toMatch(/^[0-9a-f-]{36}$/);
    expect(view.host.textContent).toContain("操作已完成");
    await click(confirm(view.host));
    expect(copy).toHaveBeenCalledTimes(2);
    expect(view.loadFiles).toHaveBeenCalledTimes(2);
    expect(view.close).toHaveBeenCalledOnce();
  } finally {
    cleanup(view.root);
  }
});
it("复制自身与后代不可选，混合类型不会出现不兼容文档目标", async () => {
  const source = entry("source", "folder", null, "源"),
    child = entry("child", "folder", "source", "子目录"),
    doc = entry("doc", "doc", null, "目标文档");
  const view = await mount([source, child, doc], [source.id], true);
  try {
    await search(view.host, "源");
    expect(
      (
        view.host.querySelector(
          '[aria-label="选择目标 源"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        view.host.querySelector(
          '[aria-label="选择目标 源 / 子目录"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(view.host.textContent).toContain("不能复制到子目录");
    await search(view.host, "目标文档");
    expect(
      view.host.querySelector('[aria-label="选择目标 目标文档"]'),
    ).toBeNull();
  } finally {
    cleanup(view.root);
  }
});
it("身份或空间切换取消请求，不会将旧操作完成状态带给新账号", async () => {
  let resolve!: () => void;
  const copy = vi.spyOn(filesApi, "batchCopy").mockImplementation(async () => {
    await new Promise<void>((done) => {
      resolve = done;
    });
    return { items: [], total: 1 };
  });
  const file = entry("source", "doc");
  const view = await mount([file], [file.id], true);
  try {
    await act(async () => {
      confirm(view.host).click();
    });
    expect(copy).toHaveBeenCalledOnce();
    await act(async () => useWorkspace.setState({ space: "other" }));
    expect(copy.mock.calls[0][4]?.aborted).toBe(true);
    await act(async () => resolve());
    expect(view.loadFiles).not.toHaveBeenCalled();
    expect(view.onCompleted).not.toHaveBeenCalled();
    expect(view.close).toHaveBeenCalled();
  } finally {
    cleanup(view.root);
  }
});
