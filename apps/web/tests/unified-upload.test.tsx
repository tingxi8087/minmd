import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import FileDialogs from "../src/components/FileDialogs";
import { useWorkspace } from "../src/store/workspace";
const { upload, uploadPptx, basis, bind, validate } = vi.hoisted(() => ({
  upload: vi.fn(),
  uploadPptx: vi.fn(),
  basis: vi.fn(),
  bind: vi.fn(),
  validate: vi.fn(),
}));
vi.mock("@/api/assets", () => ({
  assetsApi: {
    uploadMedia: upload,
    upload: uploadPptx,
    presentation: basis,
    bindPresentation: bind,
  },
}));
vi.mock("@/utils/presentationFiles", () => ({
  validatePresentation: validate,
}));
vi.mock("@/components/ShareDialog", () => ({ default: () => null }));
vi.mock("antd", async (original) => {
  const actual = await original<typeof import("antd")>();
  return {
    ...actual,
    App: {
      useApp: () => ({
        message: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
        modal: {},
      }),
    },
    Modal: ({
      children,
      title,
      onOk,
    }: React.ComponentProps<typeof actual.Modal>) => (
      <div role="dialog">
        <h2>{title}</h2>
        {children}
        <button onClick={onOk}>确定上传</button>
      </div>
    ),
    Upload: {
      ...actual.Upload,
      Dragger: ({
        beforeUpload,
        children,
        accept,
      }: {
        beforeUpload: (file: File) => unknown;
        children: React.ReactNode;
        accept: string;
      }) => (
        <div>
          <input
            type="file"
            accept={accept}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) beforeUpload(file);
            }}
          />
          {children}
        </div>
      ),
    },
  };
});
it.each([
  [
    "test.pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  ["test.pdf", "application/pdf"],
  ["test.png", "image/png"],
  ["test.mp4", "video/mp4"],
])(
  "统一入口选择 %s 后自动提交文件，保留目标文件夹并打开结果",
  async (name, mime) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const previous = useWorkspace.getState();
    const refresh = vi.fn().mockResolvedValue(undefined),
      created = vi.fn(),
      close = vi.fn();
    const add = vi.fn().mockResolvedValue("uploaded-pptx");
    useWorkspace.setState({ space: "upload-space", loadFiles: refresh, add });
    uploadPptx.mockResolvedValue({ id: "pptx-asset" });
    basis.mockResolvedValue({ revision: 1, epoch: 1 });
    bind.mockResolvedValue({});
    validate.mockResolvedValue({});
    upload.mockResolvedValue({ id: "uploaded-media" });
    const host = document.createElement("div"),
      root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <FileDialogs
            action={{ type: "upload", parent: "target-folder" }}
            close={close}
            onCreated={created}
          />,
        ),
      );
      expect(host.textContent).toContain("上传文件");
      expect(host.textContent).toContain("PPTX / PDF ≤ 50 MB");
      expect(host.textContent).toContain("视频（MP4 / WebM）≤ 200 MB");
      const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
      expect(input.accept).toContain(".pptx,.pdf,.mp4,.webm");
      const file = new File(["fixture"], name!, { type: mime });
      Object.defineProperty(input, "files", { value: [file] });
      await act(async () =>
        input.dispatchEvent(new Event("change", { bubbles: true })),
      );
      expect(
        host.querySelector<HTMLInputElement>('input:not([type="file"])')?.value,
      ).toBe(name);
      await act(async () =>
        host.querySelector<HTMLButtonElement>("button")!.click(),
      );
      if (name?.endsWith(".pptx")) {
        expect(validate).toHaveBeenCalledWith(file);
        expect(upload).not.toHaveBeenCalled();
        expect(add).toHaveBeenCalledWith(name, "slide", "target-folder");
        expect(bind).toHaveBeenCalledWith(
          "uploaded-pptx",
          "pptx-asset",
          { revision: 1, epoch: 1 },
          expect.any(AbortSignal),
        );
        expect(created).toHaveBeenCalledWith("uploaded-pptx");
      } else {
        expect(upload).toHaveBeenCalledWith(
          "upload-space",
          file,
          "target-folder",
          name,
          expect.any(AbortSignal),
        );
        expect(refresh).toHaveBeenCalled();
        expect(created).toHaveBeenCalledWith("uploaded-media");
      }
      expect(close).toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      useWorkspace.setState(previous);
      upload.mockClear();
      vi.unstubAllGlobals();
    }
  },
);
