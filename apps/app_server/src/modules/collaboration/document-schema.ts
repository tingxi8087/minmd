import { Extension, Node, getSchema, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  TextStyle,
  Color,
  BackgroundColor,
  FontSize,
} from "@tiptap/extension-text-style";
import Image from "@tiptap/extension-image";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "y-prosemirror";
import * as Y from "yjs";
import { AppError } from "../../../../../system/server/src/errors";

const attributes = Extension.create({
  name: "minmdAttributes",
  addGlobalAttributes: () => [
    {
      types: [
        "paragraph",
        "heading",
        "blockquote",
        "codeBlock",
        "bulletList",
        "orderedList",
        "taskList",
        "table",
        "callout",
        "fold",
        "image",
          "listItem",
          "taskItem",
          "tableRow",
          "tableCell",
          "tableHeader",
          "horizontalRule",
      ],
      attributes: { blockId: { default: null } },
    },
    { types: ["heading"], attributes: { collapsed: { default: false } } },
    {
      types: ["image"],
      attributes: {
        assetId: { default: null },
        width: { default: null },
        height: { default: null },
        align: { default: "left" },
      },
    },
  ],
});
const callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes: () => ({
    emoji: { default: "💡" },
    tone: { default: "amber" },
  }),
});
const fold = Node.create({
  name: "fold",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes: () => ({
    title: { default: "折叠标题" },
    open: { default: true },
  }),
});
const reference = Node.create({
  name: "documentReference",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({
    id: { default: "" },
    name: { default: "未命名文档" },
  }),
});
export const documentSchema = getSchema([
  StarterKit.configure({ undoRedo: false }),
  TableKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  TextStyle,
  Color,
  BackgroundColor,
  FontSize,
  Image,
  callout,
  fold,
  reference,
  attributes,
]);

/** 校验格式后分配稳定块 ID；不会在每次读取重新生成。 */
export function normalizeDocument(input: JSONContent): JSONContent {
  const result = structuredClone(input);
  const ids = new Set<string>();
  let count = 0;
  const visit = (node: JSONContent, depth: number) => {
    if (depth > 64 || ++count > 100000)
      throw new AppError("CONTENT_INVALID", "文档结构过深或节点过多", 400);
    if (
      node.type &&
      documentSchema.nodes[node.type]?.isBlock &&
      node.type !== "doc"
    ) {
      const current = node.attrs?.blockId;
      const id =
        typeof current === "string" &&
        /^[A-Za-z0-9_-]{1,80}$/.test(current) &&
        !ids.has(current)
          ? current
          : crypto.randomUUID();
      node.attrs = { ...node.attrs, blockId: id };
      ids.add(id);
    }
    node.content?.forEach((child) => visit(child, depth + 1));
  };
  visit(result, 0);
  try {
    const node = documentSchema.nodeFromJSON(result);
    if (node.type.name !== "doc") throw Error("根节点无效");
    node.check();
    return node.toJSON() as JSONContent;
  } catch {
    throw new AppError(
      "CONTENT_INVALID",
      "文档包含不支持的节点或无效结构",
      400,
    );
  }
}
export function createDocumentState(
  json: JSONContent = { type: "doc", content: [{ type: "paragraph" }] },
) {
  const doc = prosemirrorJSONToYDoc(
    documentSchema,
    normalizeDocument(json),
    "default",
  );
  doc.getMap("minmd").set("initialized", true);
  return doc;
}
export function documentProjection(doc: Y.Doc): JSONContent {
  const result = yDocToProsemirrorJSON(doc, "default") as JSONContent;
  const node = documentSchema.nodeFromJSON(result);
  node.check();
  return node.toJSON() as JSONContent;
}
