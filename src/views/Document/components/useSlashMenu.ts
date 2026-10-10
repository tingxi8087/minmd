import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Heading1,
  Heading2,
  Heading3,
  Type,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code2,
  Table2,
  Minus,
  ImagePlus,
} from "lucide-react";
export function useSlashMenu(editor: Editor | null, onImage: () => void) {
  const [menu, setMenu] = useState<{
    from: number;
    to: number;
    query: string;
    x: number;
    y: number;
  } | null>(null);
  const [selected, setSelected] = useState(0);
  const items = [
    {
      id: "text",
      title: "正文",
      hint: "普通文本段落",
      keywords: "text paragraph",
      icon: Type,
      run: () => editor!.chain().focus().setParagraph().run(),
    },
    ...([1, 2, 3] as const).map((level) => ({
      id: `h${level}`,
      title: `标题 ${level}`,
      hint: ["大标题，划分章节", "小标题，组织内容", "三级标题，细化结构"][
        level - 1
      ],
      keywords: `heading h${level}`,
      icon: [Heading1, Heading2, Heading3][level - 1],
      run: () => editor!.chain().focus().setHeading({ level }).run(),
    })),
    {
      id: "bullet",
      title: "无序列表",
      hint: "用圆点列出内容",
      keywords: "list bullet",
      icon: List,
      run: () => editor!.chain().focus().toggleBulletList().run(),
    },
    {
      id: "ordered",
      title: "有序列表",
      hint: "记录步骤与顺序",
      keywords: "list ordered",
      icon: ListOrdered,
      run: () => editor!.chain().focus().toggleOrderedList().run(),
    },
    {
      id: "task",
      title: "任务列表",
      hint: "勾选你的待办事项",
      keywords: "todo task",
      icon: ListTodo,
      run: () => editor!.chain().focus().toggleTaskList().run(),
    },
    {
      id: "quote",
      title: "引用",
      hint: "让一句话更醒目",
      keywords: "quote",
      icon: Quote,
      run: () => editor!.chain().focus().toggleBlockquote().run(),
    },
    {
      id: "code",
      title: "代码块",
      hint: "保留代码与格式",
      keywords: "code",
      icon: Code2,
      run: () => editor!.chain().focus().toggleCodeBlock().run(),
    },
    {
      id: "table",
      title: "表格",
      hint: "插入三行三列表格",
      keywords: "table",
      icon: Table2,
      run: () =>
        editor!
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      id: "image",
      title: "图片",
      hint: "从本地插入图片",
      keywords: "image",
      icon: ImagePlus,
      run: onImage,
    },
    {
      id: "divider",
      title: "分割线",
      hint: "为内容分个段落",
      keywords: "divider line",
      icon: Minus,
      run: () => editor!.chain().focus().setHorizontalRule().run(),
    },
  ];
  const filtered = items.filter(
    (item) =>
      !menu?.query ||
      `${item.title} ${item.keywords}`
        .toLowerCase()
        .includes(menu.query.toLowerCase()),
  );
  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      const { $from, empty, from } = editor.state.selection;
      if (!empty || $from.parent.type.name !== "paragraph") {
        setMenu(null);
        return;
      }
      const text = $from.parent.textBetween(0, $from.parentOffset);
      const match = /^\/([^/\n]{0,24})$/.exec(text);
      if (!match) {
        setMenu(null);
        return;
      }
      const rect = editor.view.coordsAtPos(from);
      const availableBelow = window.innerHeight - rect.bottom - 20;
      setMenu({
        from: $from.start(),
        to: from,
        query: match[1],
        x: Math.max(8, Math.min(rect.left, window.innerWidth - 290)),
        y:
          availableBelow < 180
            ? Math.max(8, rect.top - Math.min(360, rect.top - 16) - 8)
            : rect.bottom + 8,
      });
    };
    const hide = () => setMenu(null);
    editor.on("transaction", sync);
    editor.on("blur", hide);
    return () => {
      editor.off("transaction", sync);
      editor.off("blur", hide);
    };
  }, [editor]);
  useEffect(() => setSelected(0), [menu?.query]);
  const choose = (index: number) => {
    if (!editor || !menu || !filtered[index]) return;
    editor.chain().focus().deleteRange({ from: menu.from, to: menu.to }).run();
    filtered[index].run();
    setMenu(null);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!menu || event.isComposing) return false;
    if (event.key === "Escape") {
      setMenu(null);
      event.preventDefault();
      return true;
    }
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      setSelected((i) =>
        filtered.length
          ? (i + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) %
            filtered.length
          : 0,
      );
      return true;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(selected);
      return true;
    }
    return false;
  };
  return { menu, filtered, selected, choose, onKeyDown };
}
