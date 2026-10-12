import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { aiApi, type ApiKey } from "../src/api/ai";
import { useAuth } from "../src/store/auth";
import AiSettings from "../src/views/Settings/components/AiSettings";
const feedback = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("antd", async (original) => {
  const actual = await original<typeof import("antd")>();
  return {
    ...actual,
    App: {
      useApp: () => ({
        message: feedback,
        modal: {
          confirm: (options: { onOk?: () => unknown }) => options.onOk?.(),
        },
      }),
    },
    Modal: ({
      open,
      title,
      children,
      onOk,
      okText,
      onCancel,
    }: React.ComponentProps<typeof actual.Modal>) =>
      open ? (
        <div role="dialog">
          <h2>{title}</h2>
          {children}
          <button onClick={onOk}>{okText}</button>
          <button onClick={onCancel}>关闭</button>
        </div>
      ) : null,
  };
});
const click = async (button: Element | null | undefined) => {
  expect(button).toBeTruthy();
  await act(async () => (button as HTMLElement).click());
};
const button = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll("button")).find(
    (element) => element.textContent === text,
  );
it("预设创建、原文查看、编辑后权限更新，删除从列表消失", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAuth.setState({
    user: { id: "owner" } as NonNullable<
      ReturnType<typeof useAuth.getState>["user"]
    >,
  });
  const key: ApiKey = {
    id: "key",
    spaceId: "space",
    createdBy: "owner",
    name: "助手",
    prefix: "minmd_prefix",
    permissions: ["read"],
    canReveal: true,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: "2026-10-12",
  };
  vi.spyOn(aiApi, "keys").mockResolvedValue([]);
  const create = vi
    .spyOn(aiApi, "create")
    .mockImplementation(async (_space, input) => ({
      key: { ...key, ...input },
      secret: "minmd_created",
    }));
  const update = vi
    .spyOn(aiApi, "update")
    .mockImplementation(async (_id, input) => ({ ...key, ...input }));
  vi.spyOn(aiApi, "reveal").mockResolvedValue("minmd_created");
  const remove = vi.spyOn(aiApi, "revoke").mockResolvedValue();
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<AiSettings spaceId="space" owner />));
    await click(button(host, "创建密钥"));
    const input = host.querySelector("#ai-key-name")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "助手");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(host.querySelector('button[aria-pressed="false"]'));
    // The first inactive preset is content editing, after the default read preset.
    await click(
      Array.from(host.querySelectorAll('[role="dialog"] button')).find(
        (element) => element.textContent === "创建密钥",
      ),
    );
    expect(create).toHaveBeenCalledWith(
      "space",
      expect.objectContaining({ name: "助手", permissions: ["read", "edit"] }),
    );
    expect(host.textContent).toContain("minmd_created");
    await click(button(host, "完成"));
    await click(host.querySelector('[aria-label="查看密钥 助手"]'));
    expect(host.textContent).toContain("minmd_created");
    await click(button(host, "关闭"));
    await click(host.querySelector('[aria-label="编辑密钥 助手"]'));
    await click(
      Array.from(host.querySelectorAll('[role="dialog"] button')).find(
        (element) => element.textContent?.includes("只读助手"),
      ),
    );
    update.mockRejectedValueOnce(new Error("保存失败"));
    await click(button(host, "保存修改"));
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(feedback.error).toHaveBeenCalledWith("保存失败");
    await click(button(host, "保存修改"));
    expect(update).toHaveBeenCalledWith(
      "key",
      expect.objectContaining({ permissions: ["read"] }),
    );
    await click(host.querySelector('[aria-label="删除密钥 助手"]'));
    expect(remove).toHaveBeenCalledWith("key");
    expect(host.querySelector('[aria-label="编辑密钥 助手"]')).toBeNull();
    expect(host.textContent).toContain("还没有密钥");
  } finally {
    act(() => root.unmount());
  }
});
