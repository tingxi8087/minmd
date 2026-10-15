import { StrictMode, act, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
} from "react-router-dom";
import { expect, it } from "vitest";
import PageTitles, {
  formatPageTitle,
  usePageTitle,
} from "../src/components/PageTitles";
import { useAuth } from "../src/store/auth";
import { useWorkspace } from "../src/store/workspace";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const user = { id: "user-1", account: "test", nickname: "测试", avatar: "" };
it("路由标题覆盖登录、初始化、空间列表、设置、通知和分享，空间名称实时更新", async () => {
  const auth = useAuth.getState(),
    workspace = useWorkspace.getState();
  const host = document.createElement("div"),
    root = createRoot(host);
  useAuth.setState({ user, status: "authenticated" });
  useWorkspace.setState({
    space: "space-1",
    spaces: [
      {
        id: "space-1",
        name: "设计空间",
        caption: "",
        initials: "S",
        members: 1,
      },
    ],
  });
  const router = createMemoryRouter(
    [{ element: <PageTitles />, children: [{ path: "*", element: <div /> }] }],
    { initialEntries: ["/files"] },
  );
  try {
    await act(async () => root.render(<RouterProvider router={router} />));
    expect(document.title).toBe("设计空间 · minmd");
    for (const [path, title] of [
      ["/login", "登录"],
      ["/setup", "创建你的空间"],
      ["/notifications", "通知"],
      ["/favorites", "收藏 · 设计空间"],
      ["/settings/ai", "AI 接入 · 设计空间"],
      ["/share/secret-token", "公开分享"],
      ["/preview/file-1", "正在打开文件"],
    ]) {
      await act(async () => {
        await router.navigate(path);
      });
      expect(document.title).toBe(`${title} · minmd`);
    }
    await act(async () => {
      await router.navigate("/recent");
    });
    await act(async () =>
      useWorkspace.setState({
        spaces: [{ ...useWorkspace.getState().spaces[0], name: "更新的空间" }],
      }),
    );
    expect(document.title).toBe("最近访问 · 更新的空间 · minmd");
    expect(formatPageTitle("  标题\n换行  ")).toBe("标题 换行 · minmd");
  } finally {
    await act(async () => root.unmount());
    router.dispose();
    useAuth.setState(auth);
    useWorkspace.setState(workspace);
  }
});
it("授权后才显示文件名；重命名同步、切换文件与退出清除旧标题，StrictMode 下标题所有权稳定", async () => {
  const auth = useAuth.getState();
  useAuth.setState({ user, status: "authenticated" });
  const host = document.createElement("div"),
    root = createRoot(host);
  type Content = { path: string; userId: string; name: string; input?: string };
  let publish: (content: Content | null) => void = () => {};
  function ContentTitle({ text }: { text?: string }) {
    usePageTitle(text, 2);
    return null;
  }
  function Probe() {
    const path = useLocation().pathname;
    const current = useAuth((state) => state.user?.id);
    const [content, setContent] = useState<Content | null>(null);
    publish = setContent;
    const valid = content?.path === path && content.userId === current;
    usePageTitle(valid ? content.name : null);
    return valid ? <ContentTitle text={content.input} /> : null;
  }
  const router = createMemoryRouter(
    [
      {
        element: <PageTitles />,
        children: [{ path: "*", element: <Probe /> }],
      },
    ],
    { initialEntries: ["/document/first"] },
  );
  try {
    await act(async () =>
      root.render(
        <StrictMode>
          <RouterProvider router={router} />
        </StrictMode>,
      ),
    );
    expect(document.title).toBe("正在打开文件 · minmd");
    await act(async () =>
      publish({
        path: "/document/first",
        userId: user.id,
        name: "服务端名称",
        input: "正在输入的标题",
      }),
    );
    expect(document.title).toBe("正在输入的标题 · minmd");
    await act(async () =>
      publish({ path: "/document/first", userId: user.id, name: "外部重命名" }),
    );
    expect(document.title).toBe("外部重命名 · minmd");
    await act(async () => {
      await router.navigate("/document/second");
    });
    expect(document.title).toBe("正在打开文件 · minmd");
    await act(async () =>
      publish({
        path: "/document/first",
        userId: user.id,
        name: "迟到的旧响应",
      }),
    );
    expect(document.title).toBe("正在打开文件 · minmd");
    await act(async () =>
      publish({
        path: "/document/second",
        userId: user.id,
        name: "无访问权限",
      }),
    );
    expect(document.title).toBe("无访问权限 · minmd");
    await act(async () =>
      useAuth.setState({ user: null, status: "anonymous" }),
    );
    expect(document.title).toBe("正在打开文件 · minmd");
    await act(async () => {
      await router.navigate("/login");
    });
    expect(document.title).toBe("登录 · minmd");
  } finally {
    await act(async () => root.unmount());
    router.dispose();
    useAuth.setState(auth);
  }
});
