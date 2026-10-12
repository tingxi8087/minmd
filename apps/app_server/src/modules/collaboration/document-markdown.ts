import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { AppError } from "../../../../../system/server/src/errors";

const markdown = new MarkdownManager({
  extensions: [
    StarterKit.configure({ undoRedo: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit,
    Image,
  ],
});

/** 仅解析内容；稳定ID、附件归属和协作提交仍由权威文档事务统一处理。 */
export function parseMarkdownBlocks(text: string) {
  if (!text.trim() || Buffer.byteLength(text) > 128 * 1024)
    throw new AppError(
      "COMMAND_INVALID",
      "Markdown块不能为空或超过128KiB",
      400,
    );
  try {
    return markdown.parse(text).content ?? [];
  } catch {
    throw new AppError("CONTENT_INVALID", "Markdown内容无法解析", 400);
  }
}
