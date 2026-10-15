import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  createMemoryRouter,
  RouterProvider,
  useParams,
} from "react-router-dom";
import { expect, it, vi } from "vitest";
import PageTitles from "../src/components/PageTitles";
import FileAccessGate from "../src/components/FileAccessGate";
import { fileAccessApi, FILE_ACCESS_CHANGED } from "../src/api/fileAccess";
import type { RemoteFile } from "../src/api/files";
import { useAuth } from "../src/store/auth";
vi.mock("../src/views/Document/components/VersionHistory", () => ({
  ReadonlyPreview: () => null,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("真实权限入口在授权和元数据读取后显示标题，重命名刷新；无权限及迟到响应不暴露旧文件名", async () => {
  const auth = useAuth.getState();
  useAuth.setState({
    status: "authenticated",
    user: { id: "title-user", account: "title", nickname: "", avatar: "" },
  });
  const access = vi
    .spyOn(fileAccessApi, "access")
    .mockImplementation(async (id) => ({
      permission: id === "denied" ? null : "edit",
      member: true,
      request: null,
    }));
  const remote = (id: string, name: string): RemoteFile => ({
    id,
    name,
    spaceId: "title-space",
    kind: "doc",
    parentId: null,
    position: 0,
    createdBy: "title-user",
    visibility: "private",
    metadataRevision: 1,
    deletedBatch: null,
    deletedAt: null,
    createdAt: "",
    updatedAt: "",
  });
  let resolveFile: (file: RemoteFile) => void = () => {};
  let name = "已授权的文档";
  const file = vi.spyOn(fileAccessApi, "file").mockImplementation(async (id) =>
    id === "pending"
      ? new Promise<RemoteFile>((resolve) => {
          resolveFile = resolve;
        })
      : remote(id, name),
  );
  const host = document.createElement("div"),
    root = createRoot(host);
  function Gate() {
    const { id = "" } = useParams();
    return (
      <FileAccessGate fileId={id}>
        {(entry) => <div>{entry.name}</div>}
      </FileAccessGate>
    );
  }
  const router = createMemoryRouter(
    [
      {
        element: <PageTitles />,
        children: [{ path: "/document/:id", element: <Gate /> }],
      },
    ],
    { initialEntries: ["/document/first"] },
  );
  try {
    await act(async () => root.render(<RouterProvider router={router} />));
    expect(document.title).toBe("已授权的文档 · minmd");
    name = "从侧栏重命名";
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(FILE_ACCESS_CHANGED, { detail: "first" }),
      );
    });
    expect(document.title).toBe("从侧栏重命名 · minmd");
    await act(async () => {
      await router.navigate("/document/pending");
    });
    expect(document.title).toBe("正在打开文件 · minmd");
    await act(async () => {
      await router.navigate("/document/denied");
    });
    expect(document.title).toBe("无访问权限 · minmd");
    expect(file.mock.calls.some(([id]) => id === "denied")).toBe(false);
    await act(async () => resolveFile(remote("pending", "迟到的私有文件名")));
    expect(document.title).toBe("无访问权限 · minmd");
    await act(async () =>
      useAuth.setState({ status: "anonymous", user: null }),
    );
    expect(document.title).toBe("正在打开文件 · minmd");
  } finally {
    await act(async () => root.unmount());
    router.dispose();
    access.mockRestore();
    file.mockRestore();
    useAuth.setState(auth);
  }
});
