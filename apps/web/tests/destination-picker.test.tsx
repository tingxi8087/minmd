import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { expect, it, vi } from "vitest";
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
async function mount(file: Entry, files: Entry[], restore = false) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAuth.setState({
    user: { id: "user" } as NonNullable<
      ReturnType<typeof useAuth.getState>["user"]
    >,
  });
  const relocate = vi.fn(async () => true),
    patch = vi.fn(async () => {}),
    close = vi.fn();
  useWorkspace.setState({
    space: "space",
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
    files,
    relocate,
    patch,
  });
  const host = document.createElement("div");
  const root = createRoot(host);
  const action: FileAction = { type: restore ? "restore" : "move", file };
  await act(async () =>
    root.render(<FileDialogs action={action} close={close} />),
  );
  return { host, root, relocate, patch, close };
}
const confirm = (host: HTMLElement) =>
  Array.from(host.querySelectorAll("button")).find((button) =>
    /^(移动|恢复)到此处$/.test(button.textContent ?? ""),
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
it("当前位置禁用提交，搜索显示完整路径，选择嵌套文件夹并移动", async () => {
  const file = entry("source", "doc"),
    folder = entry("folder", "folder", null, "项目"),
    nested = entry("nested", "folder", "folder", "设计");
  const view = await mount(file, [file, folder, nested]);
  try {
    expect(confirm(view.host).disabled).toBe(true);
    await click(confirm(view.host));
    expect(view.relocate).not.toHaveBeenCalled();
    await search(view.host, "设计");
    await click(view.host.querySelector('[aria-label="选择目标 项目 / 设计"]'));
    expect(view.host.textContent).toContain("测试空间 / 项目 / 设计");
    expect(confirm(view.host).disabled).toBe(false);
    await act(async () =>
      useWorkspace.setState({
        files: [{ ...file, parent: "nested" }, folder, nested],
      }),
    );
    expect(confirm(view.host).disabled).toBe(true);
    await act(async () =>
      useWorkspace.setState({ files: [file, folder, nested] }),
    );
    expect(confirm(view.host).disabled).toBe(false);
    view.relocate.mockRejectedValueOnce(new Error("移动失败"));
    await click(confirm(view.host));
    expect(view.close).not.toHaveBeenCalled();
    expect(confirm(view.host).disabled).toBe(false);
    await click(confirm(view.host));
    expect(view.relocate).toHaveBeenCalledWith("source", "nested");
    expect(view.close).toHaveBeenCalledTimes(1);
  } finally {
    cleanup(view.root);
  }
});
it("自身和子目录不可选，选择后目标删除会立即禁用提交", async () => {
  const file = entry("source", "folder", null, "来源"),
    child = entry("child", "folder", "source", "子目录"),
    target = entry("target", "folder", null, "目标");
  const view = await mount(file, [file, child, target]);
  try {
    await search(view.host, "来源");
    const own = view.host.querySelector(
      '[aria-label="选择目标 来源"]',
    ) as HTMLButtonElement;
    expect(own.disabled).toBe(true);
    expect(view.host.textContent).toContain("不能移入自身");
    await search(view.host, "子目录");
    expect(
      (
        view.host.querySelector(
          '[aria-label="选择目标 来源 / 子目录"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(view.host.textContent).toContain("不能移入子目录");
    await search(view.host, "目标");
    await click(view.host.querySelector('[aria-label="选择目标 目标"]'));
    await act(async () =>
      useWorkspace.setState({
        files: [file, child, { ...target, deleted: true }],
      }),
    );
    expect(confirm(view.host).disabled).toBe(true);
    await click(confirm(view.host));
    expect(view.relocate).not.toHaveBeenCalled();
  } finally {
    cleanup(view.root);
  }
});
it.each(["doc", "sheet", "slide"] as const)(
  "%s 的目标类型遵循已有文档层级规则",
  async (kind) => {
    const file = entry("source", kind),
      parent = entry("parent", "doc", null, "父文档");
    const view = await mount(file, [file, parent]);
    try {
      await search(view.host, "父文档");
      const target = view.host.querySelector('[aria-label="选择目标 父文档"]');
      if (kind === "doc") {
        await click(target);
        await click(confirm(view.host));
        expect(view.relocate).toHaveBeenCalledWith("source", "parent");
      } else {
        expect(target).toBeNull();
        expect(view.host.textContent).toContain("没有找到匹配的位置");
      }
    } finally {
      cleanup(view.root);
    }
  },
);
it("恢复时可选择原根目录，提交复用恢复接口而非移动接口", async () => {
  const file = { ...entry("source", "doc"), deleted: true };
  const view = await mount(file, [file], true);
  try {
    expect(confirm(view.host).disabled).toBe(false);
    await click(confirm(view.host));
    expect(view.patch).toHaveBeenCalledWith("source", {
      deleted: false,
      parent: null,
    });
    expect(view.relocate).not.toHaveBeenCalled();
  } finally {
    cleanup(view.root);
  }
});

it("默认展开当前位置层级，搜索前后的展开状态保持", async () => {
  const folder = entry("folder", "folder", null, "项目"),
    nested = entry("nested", "folder", "folder", "设计"),
    file = entry("source", "doc", "nested");
  const view = await mount(file, [file, folder, nested]);
  const folderRow = () =>
    Array.from(view.host.querySelectorAll(".ant-tree-treenode")).find(
      (row) => row.querySelector(".ant-tree-title")?.textContent === "项目",
    )!;
  try {
    expect(
      view.host.querySelector(".ant-tree-node-selected")?.textContent,
    ).toContain("设计");
    await click(folderRow().querySelector(".ant-tree-switcher"));
    await search(view.host, "设计");
    expect(
      view.host.querySelector('[aria-label="选择目标 项目 / 设计"]'),
    ).not.toBeNull();
    await search(view.host, "");
    expect(
      folderRow().querySelector(".ant-tree-switcher_close"),
    ).not.toBeNull();
    expect(confirm(view.host).disabled).toBe(true);
  } finally {
    cleanup(view.root);
  }
});
it("恢复的原父目录已删除时，选择有效目录后才允许提交", async () => {
  const file = { ...entry("source", "doc", "deleted-folder"), deleted: true },
    parent = { ...entry("deleted-folder", "folder"), deleted: true };
  const view = await mount(file, [file, parent], true);
  try {
    expect(confirm(view.host).disabled).toBe(true);
    await click(
      Array.from(view.host.querySelectorAll("button")).find((button) =>
        button.textContent?.startsWith("空间根目录"),
      ),
    );
    expect(confirm(view.host).disabled).toBe(false);
    await click(confirm(view.host));
    expect(view.patch).toHaveBeenCalledWith("source", {
      deleted: false,
      parent: null,
    });
  } finally {
    cleanup(view.root);
  }
});
