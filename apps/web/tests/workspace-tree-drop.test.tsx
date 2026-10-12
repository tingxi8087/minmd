import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import WorkspaceTree from "../src/layout/components/WorkspaceTree";
import { fromRemoteFile, useWorkspace } from "../src/store/workspace";
vi.mock("@/components/FileDialogs", () => ({ default: () => null }));
vi.mock("antd", async (original) => {
  const actual = await original<typeof import("antd")>();
  return {
    ...actual,
    App: {
      useApp: () => ({
        message: { warning: vi.fn(), error: vi.fn() },
        modal: { confirm: vi.fn() },
      }),
    },
  };
});
const drag = async (element: Element, type: string, y: number) => {
  await act(async () => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: y,
    });
    Object.defineProperty(event, "dataTransfer", {
      value: { setData: vi.fn(), getData: () => "", dropEffect: "move" },
    });
    element.dispatchEvent(event);
  });
};
it.each([
  {
    label: "文档移入",
    kind: "doc",
    y: 108,
    targetParent: null,
    expectedParent: "target",
    index: undefined,
    allowed: true,
  },
  {
    label: "文件夹移入",
    kind: "folder",
    y: 108,
    targetParent: null,
    expectedParent: "target",
    index: undefined,
    allowed: true,
  },
  {
    label: "底部边缘同级排序",
    kind: "doc",
    y: 131,
    targetParent: null,
    expectedParent: null,
    index: 1,
    allowed: true,
  },
  {
    label: "禁止移入自己的子文件夹",
    kind: "folder",
    y: 108,
    targetParent: "source",
    expectedParent: "target",
    index: undefined,
    allowed: false,
  },
] as const)(
  "$label",
  async ({ kind, y, targetParent, expectedParent, index, allowed }) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 100,
      top: 100,
      left: 0,
      bottom: 132,
      right: 220,
      width: 220,
      height: 32,
      toJSON: () => ({}),
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(12);
    const remote = {
      spaceId: "space",
      name: "来源",
      kind,
      parentId: null,
      position: 0,
      createdBy: "owner",
      visibility: "private" as const,
      metadataRevision: 1,
      deletedBatch: null,
      deletedAt: null,
      createdAt: "",
      updatedAt: "",
    };
    const relocate = vi.fn(async () => true);
    useWorkspace.setState({
      space: "space",
      files: [
        fromRemoteFile({ ...remote, id: "source" }),
        fromRemoteFile({
          ...remote,
          id: "target",
          name: "目标文件夹",
          kind: "folder",
          position: 1,
          parentId: targetParent,
        }),
      ],
      relocate,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <MemoryRouter
            initialEntries={["/files?folder=target"]}
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          >
            <WorkspaceTree />
          </MemoryRouter>,
        ),
      );
      const source = Array.from(
        host.querySelectorAll(".ant-tree-node-content-wrapper"),
      ).find((element) => element.textContent?.includes("来源"))!;
      const target = Array.from(
        host.querySelectorAll(".ant-tree-title > div"),
      ).find((element) => element.textContent?.includes("目标文件夹"))!;
      await drag(source, "dragstart", 116);
      await drag(target, "dragenter", y);
      await drag(target, "dragover", y);
      await drag(target, "drop", y);
      await drag(source, "dragend", y);
      if (allowed) {
        expect(relocate).toHaveBeenCalledWith("source", expectedParent, index);
        expect(relocate).toHaveBeenCalledTimes(1);
      } else {
        expect(relocate).not.toHaveBeenCalled();
      }
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  },
);
