import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
/** 无编辑器/协作副作用地解析导入文件，服务器负责schema与块ID校验。 */
export function createMarkdownManager() {
  return new MarkdownManager({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit,
      Image.configure({ allowBase64: true }),
    ],
  });
}
export function parseMarkdownDocument(text: string): JSONContent {
  return createMarkdownManager().parse(text);
}
