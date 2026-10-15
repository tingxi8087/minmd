import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceHash } from "@/components/DemoImport/source";
import { copyText, readClipboardText } from "@/utils/clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});
describe("HTTP IP 剪贴板兼容", () => {
  it("HTTP 没有 Clipboard API 时复制文字，恢复焦点和选区", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    const copy = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      value: copy,
      configurable: true,
    });
    await copyText("http://192.168.1.10:9811");
    expect(copy).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(field);
    await expect(readClipboardText()).rejects.toThrow("快捷键");
  });
  it("HTTPS 优先使用原生复制；拒绝权限或旧命令失败时正确返回结果", async () => {
    const native = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: native },
      configurable: true,
    });
    await copyText("hello");
    expect(native).toHaveBeenCalledWith("hello");
    native.mockRejectedValue(new Error("denied"));
    Object.defineProperty(document, "execCommand", {
      value: vi.fn(() => false),
      configurable: true,
    });
    await expect(copyText("hello")).rejects.toThrow("复制失败");
    expect(document.querySelector("textarea")).toBeNull();
  });
});

it("非安全上下文仍生成标准 UUID，并以兼容 SHA-256 保持旧资料导入标识一致", async () => {
  const random = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal("crypto", { getRandomValues: random });
  vi.resetModules();
  const { v4 } = await import("uuid");
  const ids = Array.from({ length: 50 }, () => v4());
  expect(new Set(ids).size).toBe(50);
  for (const id of ids)
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  expect(await sourceHash([])).toBe(
    "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  );
});
