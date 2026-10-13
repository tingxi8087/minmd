import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { aiApi, aiTemplates, type ApiKey } from "../src/api/ai";
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
      footer,
    }: React.ComponentProps<typeof actual.Modal>) =>
      open ? (
        <div role="dialog">
          <h2>{title}</h2>
          {children}
          {footer === undefined ? (
            <>
              <button onClick={onOk}>{okText}</button>
              <button onClick={onCancel}>关闭</button>
            </>
          ) : (
            footer
          )}
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
    expect(button(host, "永久")?.getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).not.toContain("为这个助手选择合适的权限");
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
      expect.objectContaining({
        name: "助手",
        permissions: ["read", "edit"],
        expiresAt: null,
      }),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(
      (host.querySelector('[aria-label="密钥 助手"]') as HTMLInputElement).type,
    ).toBe("password");
    await click(host.querySelector('[aria-label="查看密钥 助手"]'));
    expect(
      (host.querySelector('[aria-label="密钥 助手"]') as HTMLInputElement)
        .value,
    ).toBe("minmd_created");
    await click(host.querySelector('[aria-label="隐藏密钥 助手"]'));
    expect(
      (host.querySelector('[aria-label="密钥 助手"]') as HTMLInputElement).type,
    ).toBe("password");
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
it("编辑已有密钥保留原有效期，永久默认值只作用于新建", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAuth.setState({
    user: { id: "owner" } as NonNullable<
      ReturnType<typeof useAuth.getState>["user"]
    >,
  });
  const expiration = new Date(Date.now() + 86400000);
  expiration.setSeconds(0, 0);
  const key: ApiKey = {
    id: "dated",
    spaceId: "space",
    createdBy: "owner",
    name: "有期限助手",
    prefix: "minmd_prefix",
    permissions: ["read"],
    canReveal: true,
    expiresAt: expiration.toISOString(),
    revokedAt: null,
    lastUsedAt: null,
    createdAt: "2026-10-12",
  };
  vi.spyOn(aiApi, "keys").mockResolvedValue([key]);
  const update = vi
    .spyOn(aiApi, "update")
    .mockImplementation(async (_id, input) => ({ ...key, ...input }));
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<AiSettings spaceId="space" owner />));
    await click(host.querySelector('[aria-label="编辑密钥 有期限助手"]'));
    expect(button(host, "自定义")?.getAttribute("aria-pressed")).toBe("true");
    await click(button(host, "保存修改"));
    expect(update).toHaveBeenCalledWith(
      "dated",
      expect.objectContaining({ expiresAt: key.expiresAt }),
    );
  } finally {
    act(() => root.unmount());
  }
});
it("列表用预设或自定义标签概括权限，过期状态明确，完整信息可通过聚焦查看", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAuth.setState({
    user: { id: "owner" } as NonNullable<
      ReturnType<typeof useAuth.getState>["user"]
    >,
  });
  const base: ApiKey = {
    id: "full",
    spaceId: "space",
    createdBy: "owner",
    name: "完整助手",
    prefix: "minmd_prefix",
    permissions: [
      "read",
      "create",
      "edit",
      "organize",
      "delete_restore",
      "upload",
    ],
    canReveal: true,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: "2026-10-12",
  };
  vi.spyOn(aiApi, "keys").mockResolvedValue([
    base,
    {
      ...base,
      id: "custom",
      name: "自定义助手",
      permissions: ["read", "upload"],
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      canReveal: false,
    },
  ]);
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () => root.render(<AiSettings spaceId="space" owner />));
    expect(host.textContent).toContain("完整文件操作");
    expect(host.textContent).toContain("自定义 · 2 项");
    expect(host.textContent).toContain("永久");
    expect(host.textContent).toContain("已过期");
    expect(host.textContent).not.toContain("最近使用：");
    expect(host.textContent).not.toContain("读取文件与内容");
    expect(
      (
        host.querySelector(
          '[aria-label="查看密钥 自定义助手"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        host.querySelector(
          '[aria-label="复制密钥 自定义助手"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        host.querySelector(
          '[aria-label="接入配置 自定义助手"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(async () => (host.querySelector("code") as HTMLElement).focus());
    await vi.waitFor(() =>
      expect(
        document.querySelector(".ant-tooltip-inner")?.textContent,
      ).toContain("尚未使用"),
    );
    await act(async () =>
      (host.querySelector('[aria-label^="权限："]') as HTMLElement).focus(),
    );
    await vi.waitFor(() =>
      expect(
        Array.from(document.querySelectorAll(".ant-tooltip-inner")).some(
          (element) => element.textContent?.includes("删除与恢复文件"),
        ),
      ).toBe(true),
    );
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

it("行内复制真实密钥；MCP及HTTP配置按选中密钥生成，预览不暴露原文", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAuth.setState({
    user: { id: "owner" } as NonNullable<
      ReturnType<typeof useAuth.getState>["user"]
    >,
  });
  const key: ApiKey = {
    id: "copy",
    spaceId: "space",
    createdBy: "owner",
    name: "复制助手",
    prefix: "minmd_prefix",
    permissions: ["read"],
    canReveal: true,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: "2026-10-12",
  };
  vi.spyOn(aiApi, "keys").mockResolvedValue([key]);
  const reveal = vi
    .spyOn(aiApi, "reveal")
    .mockResolvedValue("minmd_copy_fixture");
  const write = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: write },
  });
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<AiSettings spaceId="space" owner />));
    expect(reveal).not.toHaveBeenCalled();
    expect(host.querySelector("pre")).toBeNull();
    await click(host.querySelector('[aria-label="复制密钥 复制助手"]'));
    expect(write).toHaveBeenLastCalledWith("minmd_copy_fixture");
    expect(
      (host.querySelector('[aria-label="密钥 复制助手"]') as HTMLInputElement)
        .type,
    ).toBe("password");
    await click(host.querySelector('[aria-label="接入配置 复制助手"]'));
    expect(host.querySelector("pre")!.textContent).toContain("mcpServers");
    expect(host.querySelector("pre")!.textContent).not.toContain(
      "minmd_copy_fixture",
    );
    await click(button(host, "复制配置"));
    expect(write).toHaveBeenLastCalledWith(
      aiTemplates(window.location.origin).mcp.replaceAll(
        "<API_KEY>",
        "minmd_copy_fixture",
      ),
    );
    await click(button(host, "HTTP API"));
    await click(button(host, "复制配置"));
    expect(write).toHaveBeenLastCalledWith(
      aiTemplates(window.location.origin).http.replaceAll(
        "<API_KEY>",
        "minmd_copy_fixture",
      ),
    );
    await click(button(host, "关闭"));
    reveal.mockRejectedValueOnce(new Error("已失效"));
    const count = write.mock.calls.length;
    await click(host.querySelector('[aria-label="复制密钥 复制助手"]'));
    expect(write).toHaveBeenCalledTimes(count);
    expect(feedback.error).toHaveBeenCalledWith("已失效");
  } finally {
    act(() => root.unmount());
  }
});
it.each(["切换账号", "删除密钥"])("读取密钥期间%s，旧请求不能显示原文或写入剪贴板", async (action) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAuth.setState({
    user: { id: "owner" } as NonNullable<
      ReturnType<typeof useAuth.getState>["user"]
    >,
  });
  const key: ApiKey = {
    id: "pending",
    spaceId: "space",
    createdBy: "owner",
    name: "异步助手",
    prefix: "minmd_prefix",
    permissions: ["read"],
    canReveal: true,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: "2026-10-12",
  };
  vi.spyOn(aiApi, "keys").mockResolvedValue([key]);
  let finish!: (secret: string) => void;
  vi.spyOn(aiApi, "reveal").mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const write = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: write },
  });
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<AiSettings spaceId="space" owner />));
    await click(host.querySelector('[aria-label="复制密钥 异步助手"]'));
    if (action === "删除密钥") {
      vi.spyOn(aiApi, "revoke").mockResolvedValue();
      await click(host.querySelector('[aria-label="删除密钥 异步助手"]'));
    } else {
      await act(async () =>
        useAuth.setState({
          user: { id: "other" } as NonNullable<
            ReturnType<typeof useAuth.getState>["user"]
          >,
        }),
      );
    }
    await act(async () => finish("minmd_old_identity_secret"));
    expect(write).not.toHaveBeenCalled();
    const input = host.querySelector<HTMLInputElement>('[aria-label="密钥 异步助手"]');
    if (action === "删除密钥") expect(input).toBeNull();
    else expect(input?.value).not.toContain("minmd_old_identity_secret");
  } finally {
    act(() => root.unmount());
  }
});
