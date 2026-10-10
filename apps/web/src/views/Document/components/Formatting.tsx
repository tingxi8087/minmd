import type { Editor } from "@tiptap/react";
import { Dropdown } from "antd";
import {
  Bold,
  Italic,
  Strikethrough,
  Underline,
  Code2,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Table2,
  Minus,
  ChevronDown,
  Undo2,
  Redo2,
  Link2,
} from "lucide-react";
import TextFormatting from "./TextFormatting";
import TooltipButton from "@/components/TooltipButton";
import styles from "../index.module.less";
export default function Formatting({
  editor,
  compact = false,
  onLink,
}: {
  editor: Editor;
  compact?: boolean;
  onLink: () => void;
}) {
  const marks = [
    {
      name: "粗体",
      icon: Bold,
      active: "bold",
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      name: "斜体",
      icon: Italic,
      active: "italic",
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      name: "下划线",
      icon: Underline,
      active: "underline",
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      name: "删除线",
      icon: Strikethrough,
      active: "strike",
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      name: "行内代码",
      icon: Code2,
      active: "code",
      run: () => editor.chain().focus().toggleCode().run(),
    },
  ];
  return (
    <div className={styles.formatting}>
      {!compact && (
        <>
          <TooltipButton
            aria-label="撤销"
            disabled={!editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 size={15} />
          </TooltipButton>
          <TooltipButton
            aria-label="重做"
            disabled={!editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 size={15} />
          </TooltipButton>
          <i />
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: "0", label: "正文" },
                { key: "1", label: "标题 1" },
                { key: "2", label: "标题 2" },
                { key: "3", label: "标题 3" },
                { key: "4", label: "标题 4" },
                { key: "5", label: "标题 5" },
                { key: "6", label: "标题 6" },
              ],
              onClick: ({ key }) =>
                key === "0"
                  ? editor.chain().focus().setParagraph().run()
                  : editor
                      .chain()
                      .focus()
                      .toggleHeading({
                        level: Number(key) as 1 | 2 | 3 | 4 | 5 | 6,
                      })
                      .run(),
            }}
          >
            <TooltipButton className={styles.blockSelect} tooltip="段落格式">
              {editor.isActive("heading")
                ? `标题 ${editor.getAttributes("heading").level}`
                : "正文"}
              <ChevronDown size={12} />
            </TooltipButton>
          </Dropdown>
          <i />
        </>
      )}
      <TextFormatting editor={editor} />
      <i />
      {marks.map(({ name, icon: Icon, active, run }) => (
        <TooltipButton
          key={name}
          aria-label={name}
          aria-pressed={editor.isActive(active)}
          className={editor.isActive(active) ? styles.activeFormat : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={run}
        >
          <Icon size={15} />
        </TooltipButton>
      ))}
      <TooltipButton
        aria-label="插入链接"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onLink}
      >
        <Link2 size={15} />
      </TooltipButton>
      {!compact && (
        <>
          <i />
          {[
            {
              name: "无序列表",
              icon: List,
              run: () => editor.chain().focus().toggleBulletList().run(),
              active: "bulletList",
            },
            {
              name: "有序列表",
              icon: ListOrdered,
              run: () => editor.chain().focus().toggleOrderedList().run(),
              active: "orderedList",
            },
            {
              name: "任务列表",
              icon: ListTodo,
              run: () => editor.chain().focus().toggleTaskList().run(),
              active: "taskList",
            },
            {
              name: "引用",
              icon: Quote,
              run: () => editor.chain().focus().toggleBlockquote().run(),
              active: "blockquote",
            },
          ].map(({ name, icon: Icon, run, active }) => (
            <TooltipButton
              key={name}
              aria-label={name}
              className={editor.isActive(active) ? styles.activeFormat : ""}
              onClick={run}
            >
              <Icon size={16} />
            </TooltipButton>
          ))}
          <i />
          <TooltipButton
            aria-label="插入表格"
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
          >
            <Table2 size={16} />
          </TooltipButton>
          <TooltipButton
            aria-label="插入分割线"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            <Minus size={16} />
          </TooltipButton>
        </>
      )}
    </div>
  );
}
