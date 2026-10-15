import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import Media from "../src/views/Media";
import MediaPreview from "../src/views/Media/MediaPreview";
import type { Entry } from "../src/store/workspace";
const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/api/assets", () => ({ assetsApi: { presentation: load } }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("antd", () => ({
  Dropdown: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/FileDialogs", () => ({ default: () => null }));
vi.mock("@/components/TooltipButton", () => ({
  default: ({
    children,
    tooltip: _tooltip,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tooltip?: string }) => (
    <button {...props}>{children}</button>
  ),
}));
it.each(["pdf", "video", "image"] as const)(
  "%s 文件根据鉴权内容选择对应预览，并显示下载入口",
  async (kind) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div"),
      root = createRoot(host);
    load.mockResolvedValue({ projection: { assetId: "private-asset" } });
    try {
      await act(async () =>
        root.render(
          <Media file={{ id: "media", name: "原文件", kind } as Entry} />,
        ),
      );
      const selector =
        kind === "pdf" ? "iframe" : kind === "video" ? "video" : "img";
      expect(host.querySelector(selector)?.getAttribute("src")).toContain(
        "/api/app/assets/private-asset",
      );
      expect(
        host
          .querySelector('button[aria-label="下载原文件"]')
          ?.hasAttribute("disabled"),
      ).toBe(false);
      if (kind === "video") {
        expect(host.querySelector("video")?.controls).toBe(true);
        expect(host.querySelector("video")?.autoplay).toBe(false);
      }
      if (kind === "pdf")
        expect(host.querySelector("iframe")?.title).toContain("PDF 预览");
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  },
);
it("图片缩放可复位，加载失败显示下载提示", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MediaPreview kind="image" url="/api/app/assets/image" name="图片" />,
      ),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="放大图片"]')!.click(),
    );
    expect(host.textContent).toContain("125%");
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="适应画布"]')!.click(),
    );
    expect(host.textContent).toContain("100%");
    await act(async () =>
      host.querySelector("img")!.dispatchEvent(new Event("error")),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "下载原文件",
    );
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
it("权限读取失败不创建媒体元素，不启用下载", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  load.mockRejectedValue(new Error("没有文件权限"));
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <Media
          file={{ id: "forbidden", name: "私有文件", kind: "pdf" } as Entry}
        />,
      ),
    );
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector("iframe,video,img")).toBeNull();
    expect(
      host
        .querySelector('button[aria-label="下载原文件"]')
        ?.hasAttribute("disabled"),
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
