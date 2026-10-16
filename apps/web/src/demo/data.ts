import type { JSONContent } from "@tiptap/core";
import type { Sheet } from "@fortune-sheet/core";
import type { RemoteFile } from "@/api/files";
import type { Asset } from "@/api/assets";
import type { Space } from "@/api/spaces";
import { createWorkbook } from "@/views/Spreadsheet/workbook";
import previewUrl from "../../../../docs/images/workspace.jpg?url";
export const demoUser = {
  id: "demo-user",
  account: "visitor",
  nickname: "体验者",
  avatar: "",
};
export const demoSpace: Space = {
  id: "demo-space",
  name: "minmd 演示空间",
  description: "随手写、放心试。刷新页面即可恢复所有示例。",
  ownerId: demoUser.id,
  createdAt: "2026-10-01T08:00:00.000Z",
  updatedAt: "2026-10-01T08:00:00.000Z",
};
export const files = new Map<string, RemoteFile>();
export const documents = new Map<string, JSONContent>();
export const workbooks = new Map<string, Sheet[]>();
export const assets = new Map<string, Asset & { blob?: Blob }>();
export const media = new Map<
  string,
  { assetId?: string; name?: string; size?: number; slides?: number }
>();
const p = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const h = (text: string): JSONContent => ({
  type: "heading",
  attrs: { level: 2 },
  content: [{ type: "text", text }],
});
export function addFile(
  name: string,
  kind: RemoteFile["kind"],
  parentId: string | null = null,
  id: string = crypto.randomUUID(),
) {
  const now = new Date().toISOString();
  const file: RemoteFile = {
    id,
    name,
    kind,
    parentId,
    spaceId: demoSpace.id,
    position: files.size,
    createdBy: demoUser.id,
    permission: "manage",
    visibility: "private",
    favorite: false,
    deletedBatch: null,
    deletedAt: null,
    metadataRevision: 1,
    createdAt: now,
    updatedAt: now,
  };
  files.set(id, file);
  if (kind === "doc") documents.set(id, { type: "doc", content: [p("")] });
  if (kind === "sheet") workbooks.set(id, createWorkbook(id, name));
  return file;
}
export function resetData() {
  for (const asset of assets.values())
    if (asset.url.startsWith("blob:")) URL.revokeObjectURL(asset.url);
  files.clear();
  documents.clear();
  workbooks.clear();
  assets.clear();
  media.clear();
  addFile("开始体验", "doc", null, "welcome").favorite = true;
  addFile("产品灵感", "folder", null, "ideas");
  addFile("把想法变成图表", "doc", "ideas", "diagrams");
  addFile("项目计划与预算", "sheet", null, "planning").favorite = true;
  addFile("空间界面预览.jpg", "image", null, "preview-image");
  documents.set("welcome", {
    type: "doc",
    content: [
      h("欢迎来到 minmd"),
      p(
        "这是一个可以随手试写的演示空间。所有修改只停留在当前页面，刷新后恢复示例，不会上传到服务器。",
      ),
      h("从一篇文档开始"),
      p(
        "点击这里输入文字。选中文字试试加粗、颜色与链接；在空白行输入 /，插入标题、表格、待办、图片或代码。",
      ),
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [p("打开一篇文档，试写几行")],
          },
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [p("体验表格的公式、筛选和格式")],
          },
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [p("拖动左侧文件，整理成自己的目录")],
          },
        ],
      },
      h("带走你的创作"),
      p(
        "文档可以导出 Markdown，表格可以导出 XLSX。也可以导入自己的文件，体验 PPT、PDF、图片和视频预览。",
      ),
      h("部署属于你的空间"),
      p(
        "完整版本支持账号、分享权限、多人协作和历史版本。点击上方 GitHub 链接即可查看源码与部署指南。",
      ),
    ],
  });
  documents.set("diagrams", {
    type: "doc",
    content: [
      h("让思路一目了然"),
      p(
        "Mermaid 默认以图表显示。点击代码块的工具栏切换源码、放大查看，试试修改下面的流程。",
      ),
      {
        type: "codeBlock",
        attrs: { language: "mermaid" },
        content: [
          {
            type: "text",
            text: "flowchart LR\n  A[记录想法] --> B[梳理结构]\n  B --> C[一起实现]\n  C --> D[持续改进]\n  D --> A",
          },
        ],
      },
      h("一段小代码"),
      {
        type: "codeBlock",
        attrs: { language: "javascript" },
        content: [
          {
            type: "text",
            text: 'const idea = "从一个小想法开始";\nconsole.log(idea);',
          },
        ],
      },
    ],
  });
  workbooks.set("planning", createWorkbook("planning", "项目计划与预算", true));
  assets.set("preview-image", {
    id: "preview-image",
    filename: "空间界面预览.jpg",
    mime: "image/jpeg",
    size: 0,
    slides: 0,
    url: previewUrl,
  });
  media.set("preview-image", {
    assetId: "preview-image",
    name: "空间界面预览.jpg",
  });
}
resetData();
