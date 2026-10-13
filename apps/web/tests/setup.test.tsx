import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { authApi } from "../src/api/auth";
import { useAuth } from "../src/store/auth";
import Setup from "../src/views/Setup";
const feedback = vi.hoisted(() => ({
  warning: vi.fn(),
  error: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => feedback.navigate }));
vi.mock("antd", async (original) => {
  const actual = await original<typeof import("antd")>();
  return { ...actual, App: { useApp: () => ({ message: feedback }) } };
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAuth.setState({ status: "anonymous", user: null });
  vi.spyOn(authApi, "setupStatus").mockResolvedValue({ needsSetup: true });
  feedback.warning.mockReset();
  feedback.error.mockReset();
  feedback.navigate.mockReset();
});
const input = async (host: HTMLElement, id: string, value: string) => {
  const element = host.querySelector<HTMLInputElement>(`#${id}`)!;
  expect(element).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const submit = async (host: HTMLElement) =>
  act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
it("两步校验密码一致性、默认空间名、返回保留输入，重复提交只初始化一次并打开引导文档", async () => {
  let finish!: (value: {
    csrfToken: string;
    spaceId: string;
    documentId: string;
  }) => void;
  const initialize = vi.fn(
    () =>
      new Promise<{ csrfToken: string; spaceId: string; documentId: string }>(
        (resolve) => {
          finish = resolve;
        },
      ),
  );
  const previous = useAuth.getState().initialize;
  useAuth.setState({ initialize });
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<Setup />));
    await input(host, "setup-account", "New_user");
    await input(host, "setup-password", "12345");
    await submit(host);
    expect(feedback.warning).toHaveBeenLastCalledWith("密码长度为 6–128 位");
    await input(host, "setup-password", "123456");
    await input(host, "setup-confirm", "654321");
    await submit(host);
    expect(feedback.warning).toHaveBeenLastCalledWith("两次输入的密码不一致");
    await input(host, "setup-confirm", "123456");
    await submit(host);
    expect(host.querySelector<HTMLInputElement>("#setup-space")!.value).toBe(
      "new_user的空间",
    );
    await act(async () =>
      (
        host.querySelector('button[type="button"]') as HTMLButtonElement
      ).click(),
    );
    expect(host.querySelector<HTMLInputElement>("#setup-account")!.value).toBe(
      "New_user",
    );
    await submit(host);
    await submit(host);
    await submit(host);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledWith({
      account: "New_user",
      nickname: "",
      password: "123456",
      spaceName: "new_user的空间",
    });
    expect(host.querySelector("fieldset")!.disabled).toBe(true);
    await act(async () =>
      finish({ csrfToken: "csrf", spaceId: "space", documentId: "welcome" }),
    );
    expect(feedback.navigate).toHaveBeenLastCalledWith("/document/welcome", {
      replace: true,
    });
  } finally {
    act(() => root.unmount());
    useAuth.setState({ initialize: previous });
  }
});
it("初始化已完成时返回登录页，查询失败提供重试而不开放表单", async () => {
  vi.mocked(authApi.setupStatus)
    .mockRejectedValueOnce(new Error("网络断开"))
    .mockResolvedValueOnce({ needsSetup: false });
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<Setup />));
    expect(host.textContent).toContain("网络断开");
    expect(host.querySelector("form")).toBeNull();
    await act(async () =>
      (host.querySelector("button") as HTMLButtonElement).click(),
    );
    expect(feedback.navigate).toHaveBeenCalledWith("/login", { replace: true });
  } finally {
    act(() => root.unmount());
  }
});
it("创建请求结果丢失时检测已完成并转登录，避免重复创建", async () => {
  const previous = useAuth.getState().initialize;
  useAuth.setState({
    initialize: vi.fn().mockRejectedValue(new Error("响应丢失")),
  });
  vi.mocked(authApi.setupStatus)
    .mockResolvedValueOnce({ needsSetup: true })
    .mockResolvedValueOnce({ needsSetup: false });
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<Setup />));
    await input(host, "setup-account", "new_user");
    await input(host, "setup-password", "123456");
    await input(host, "setup-confirm", "123456");
    await submit(host);
    await submit(host);
    expect(feedback.error).toHaveBeenCalledWith("响应丢失");
    expect(feedback.navigate).toHaveBeenCalledWith("/login", { replace: true });
  } finally {
    act(() => root.unmount());
    useAuth.setState({ initialize: previous });
  }
});
