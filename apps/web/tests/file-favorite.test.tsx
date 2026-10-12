import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AxiosHeaders } from "axios";
import { useWorkspace, fromRemoteFile } from "../src/store/workspace";
import { useAuth } from "../src/store/auth";
import { request } from "../src/http";
import { fileAccessApi } from "../src/api/fileAccess";
import FileAccessGate from "../src/components/FileAccessGate";
vi.mock("@/views/Document/components/VersionHistory", () => ({
  ReadonlyPreview: () => null,
}));

it("收藏及取消收藏完成后，权限门内的按钮无需刷新就更新；失败保持原状态", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const remote = {
    id: "doc",
    spaceId: "space",
    kind: "doc" as const,
    name: "文档",
    parentId: null,
    position: 0,
    createdBy: "owner",
    visibility: "private" as const,
    metadataRevision: 1,
    deletedBatch: null,
    deletedAt: null,
    createdAt: "2026-10-12",
    updatedAt: "2026-10-12",
    favorite: false,
  };
  useAuth.setState({
    user: { id: "owner" } as NonNullable<
      ReturnType<typeof useAuth.getState>["user"]
    >,
  });
  useWorkspace.setState({ space: "space", files: [fromRemoteFile(remote)] });
  vi.spyOn(fileAccessApi, "access").mockResolvedValue({
    permission: "manage",
    member: true,
  } as Awaited<ReturnType<typeof fileAccessApi.access>>);
  const read = vi.spyOn(fileAccessApi, "file").mockResolvedValue(remote);
  let fail = false;
  request.defaults.adapter = async (config) => {
    if (fail) throw new Error("保存失败");
    return {
      config,
      data: {},
      headers: new AxiosHeaders(),
      status: 200,
      statusText: "OK",
    };
  };
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(FileAccessGate, {
          fileId: "doc",
          children: (file) =>
            createElement("button", { "aria-pressed": file.favorite }, "收藏"),
        }),
      ),
    );
    expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe(
      "false",
    );
    await act(async () =>
      useWorkspace.getState().patch("doc", { favorite: true }),
    );
    expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    await act(async () =>
      useWorkspace.getState().patch("doc", { favorite: false }),
    );
    expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe(
      "false",
    );
    fail = true;
    await act(async () => {
      await expect(
        useWorkspace.getState().patch("doc", { favorite: true }),
      ).rejects.toThrow("保存失败");
    });
    expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
  }
});
