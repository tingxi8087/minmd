import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import FileDialogs from "../src/components/FileDialogs";
import { useWorkspace } from "../src/store/workspace";
const {
  upload,
  uploadPptx,
  basis,
  bind,
  validate,
  readSheet,
  parseMd,
  writeSheet,
  writeDoc,
} = vi.hoisted(() => ({
  upload: vi.fn(),
  uploadPptx: vi.fn(),
  basis: vi.fn(),
  bind: vi.fn(),
  validate: vi.fn(),
  readSheet: vi.fn(),
  parseMd: vi.fn(),
  writeSheet: vi.fn(),
  writeDoc: vi.fn(),
}));
vi.mock("@/views/Spreadsheet/exchange", () => ({ importXlsx: readSheet }));
vi.mock("@/views/Document/utils/markdownImport", () => ({
  parseMarkdownDocument: parseMd,
}));
vi.mock("@/api/documents", () => ({
  documentApi: { content: basis, import: writeDoc },
}));
vi.mock("@/api/sheets", () => ({
  sheetApi: { content: basis, import: writeSheet },
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
    "test.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  ["test.md", "text/markdown"],
  ["test.markdown", "text/markdown"],
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
    const add = vi.fn().mockResolvedValue("created-file");
    useWorkspace.setState({ space: "upload-space", loadFiles: refresh, add });
    uploadPptx.mockResolvedValue({ id: "pptx-asset" });
    basis.mockResolvedValue({ revision: 1, epoch: 1 });
    bind.mockResolvedValue({});
    validate.mockResolvedValue({});
    readSheet.mockResolvedValue([]);
    parseMd.mockReturnValue({ type: "doc", content: [] });
    writeSheet.mockResolvedValue({});
    writeDoc.mockResolvedValue({});
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
      expect(host.textContent).toContain("单个文件最大 200 MB");
      expect(host.textContent).toContain("MP4 / WebM");
      const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
      expect(input.accept).toContain(".pptx,.pdf,.mp4,.webm");
      const file = new File(["fixture"], name!, { type: mime });
      Object.defineProperty(file, "text", { value: async () => "# fixture" });
      Object.defineProperty(input, "files", { value: [file] });
      await act(async () =>
        input.dispatchEvent(new Event("change", { bubbles: true })),
      );
      expect(
        host.querySelector<HTMLInputElement>('input:not([type="file"])')?.value,
      ).toBe(name?.replace(/\.(xlsx|md|markdown)$/i, ""));
      await act(async () =>
        host.querySelector<HTMLButtonElement>("button")!.click(),
      );
      if (/\.(xlsx|md|markdown)$/i.test(name!)) {
        const kind = name!.endsWith(".xlsx") ? "sheet" : "doc";
        expect(add).toHaveBeenCalledWith("test", kind, "target-folder");
        expect(upload).not.toHaveBeenCalled();
        expect(kind === "sheet" ? writeSheet : writeDoc).toHaveBeenCalledWith(
          "created-file",
          kind === "sheet" ? [] : { type: "doc", content: [] },
          1,
          1,
          expect.any(AbortSignal),
        );
        expect(created).toHaveBeenCalledWith("created-file", kind);
      } else if (name?.endsWith(".pptx")) {
        expect(validate).toHaveBeenCalledWith(file);
        expect(upload).not.toHaveBeenCalled();
        expect(add).toHaveBeenCalledWith(name, "slide", "target-folder");
        expect(bind).toHaveBeenCalledWith(
          "created-file",
          "pptx-asset",
          { revision: 1, epoch: 1 },
          expect.any(AbortSignal),
        );
        expect(created).toHaveBeenCalledWith("created-file");
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
