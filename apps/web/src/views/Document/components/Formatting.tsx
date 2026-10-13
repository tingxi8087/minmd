import type { Editor } from "@tiptap/react";
import { useEffect, useState, type ReactNode } from "react";
import { Dropdown, Popover } from "antd";
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
  MoreHorizontal,
} from "lucide-react";
import TextFormatting from "./TextFormatting";
import TooltipButton from "@/components/TooltipButton";
import styles from "../index.module.less";
export default function Formatting({
  editor,
  compact = false,
  onLink,
  mobileToolbar = false,
  secondaryOnly = false,
  extra,
}: {
  editor: Editor;
  compact?: boolean;
  onLink: () => void;
  mobileToolbar?: boolean;
  secondaryOnly?: boolean;
  extra?: ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!mobileToolbar) return;
    const query = window.matchMedia("(max-width: 680px)");
    const closeOnDesktop = () => {
      if (!query.matches) setMoreOpen(false);
    };
    query.addEventListener("change", closeOnDesktop);
    return () => query.removeEventListener("change", closeOnDesktop);
  }, [mobileToolbar]);
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
    <div
      className={`${styles.formatting} ${mobileToolbar ? styles.toolbarFormatting : ""}`}
    >
      {!compact && !secondaryOnly && (
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
      <div className={styles.secondaryFormatting}>
        <TextFormatting editor={editor} />
      </div>
      <i />
      {marks
        .filter((_mark, index) => !secondaryOnly || index >= 3)
        .map(({ name, icon: Icon, active, run }, index) => (
          <TooltipButton
            key={name}
            aria-label={name}
            aria-pressed={editor.isActive(active)}
            className={`${editor.isActive(active) ? styles.activeFormat : ""} ${index >= 3 || secondaryOnly ? styles.secondaryFormatting : ""}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={run}
          >
            <Icon size={15} />
            <span className={styles.moreLabel}>{name}</span>
          </TooltipButton>
        ))}
      <TooltipButton
        className={styles.secondaryFormatting}
        aria-label="插入链接"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onLink}
      >
        <Link2 size={15} />
        <span className={styles.moreLabel}>链接</span>
      </TooltipButton>
      {!compact && (
        <div className={styles.secondaryFormatting}>
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
              <span className={styles.moreLabel}>{name}</span>
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
            <span className={styles.moreLabel}>插入表格</span>
          </TooltipButton>
          <TooltipButton
            aria-label="插入分割线"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            <Minus size={16} />
            <span className={styles.moreLabel}>分割线</span>
          </TooltipButton>
        </div>
      )}
      {extra && <div className={styles.secondaryFormatting}>{extra}</div>}
      {mobileToolbar && (
        <Popover
          trigger="click"
          placement="bottomRight"
          open={moreOpen}
          onOpenChange={setMoreOpen}
          content={
            <section
              className={styles.moreFormatting}
              aria-label="更多编辑功能"
            >
              <div className={styles.moreHeading}>文字样式、段落与插入</div>
              <Formatting
                editor={editor}
                onLink={() => {
                  setMoreOpen(false);
                  onLink();
                }}
                secondaryOnly
                extra={
                  extra && (
                    <div
                      className={styles.secondaryFormatting}
                      onClick={() => setMoreOpen(false)}
                    >
                      {extra}
                    </div>
                  )
                }
              />
            </section>
          }
        >
          <TooltipButton
            className={styles.editingMore}
            aria-label="更多编辑功能"
            tooltip={moreOpen ? "" : undefined}
            onMouseDown={(e) => e.preventDefault()}
          >
            <MoreHorizontal size={17} />
          </TooltipButton>
        </Popover>
      )}
    </div>
  );
}
