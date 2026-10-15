import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { slashPlacement } from "../utils/slashPlacement";
import type { Editor } from "@tiptap/react";
import {
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Type,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code2,
  Workflow,
  Table2,
  Minus,
  ImagePlus,
  Smile,
  CalendarDays,
  FileText,
  Lightbulb,
  PanelTopClose,
} from "lucide-react";
export function useSlashMenu(
  editor: Editor | null,
  onImage: () => void,
  onInsert: (kind: "emoji" | "date" | "reference") => void,
) {
  const [menu, setMenu] = useState<{
    from: number;
    to: number;
    query: string;
    x: number;
    y: number;
    top: number;
    bottom: number;
    maxHeight: number;
    inlineOnly: boolean;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const items = [
    {
      id: "emoji",
      title: "表情",
      keywords: "emoji bq biaoqing",
      icon: Smile,
      run: () => onInsert("emoji"),
    },
    {
      id: "date",
      title: "日期",
      keywords: "date rq riqi",
      icon: CalendarDays,
      run: () => onInsert("date"),
    },
    {
      id: "callout",
      title: "高亮块",
      keywords: "callout glk gaoliang",
      icon: Lightbulb,
      run: () =>
        editor!
          .chain()
          .focus()
          .insertContent({ type: "callout", content: [{ type: "paragraph" }] })
          .run(),
    },
    {
      id: "fold",
      title: "折叠块",
      keywords: "fold toggle zdk zhedie",
      icon: PanelTopClose,
      run: () =>
        editor!
          .chain()
          .focus()
          .insertContent({ type: "fold", content: [{ type: "paragraph" }] })
          .run(),
    },
    {
      id: "reference",
      title: "引用文档",
      keywords: "reference docs yywd wendang",
      icon: FileText,
      run: () => onInsert("reference"),
    },
    {
      id: "text",
      title: "正文",
      hint: "普通文本段落",
      keywords: "text paragraph zw zhengwen",
      icon: Type,
      run: () => editor!.chain().focus().setParagraph().run(),
    },
    ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
      id: `h${level}`,
      title: `标题 ${level}`,
      hint: [
        "大标题，划分章节",
        "小标题，组织内容",
        "三级标题，细化结构",
        "四级标题",
        "五级标题",
        "六级标题",
      ][level - 1],
      keywords: `heading h${level} bt biaoti`,
      icon: [Heading1, Heading2, Heading3, Heading4, Heading5, Heading6][
        level - 1
      ],
      run: () => editor!.chain().focus().setHeading({ level }).run(),
    })),
    {
      id: "bullet",
      title: "无序列表",
      hint: "用圆点列出内容",
      keywords: "list bullet wxlb",
      icon: List,
      run: () => editor!.chain().focus().toggleBulletList().run(),
    },
    {
      id: "ordered",
      title: "有序列表",
      hint: "记录步骤与顺序",
      keywords: "list ordered yxlb",
      icon: ListOrdered,
      run: () => editor!.chain().focus().toggleOrderedList().run(),
    },
    {
      id: "task",
      title: "任务列表",
      hint: "勾选你的待办事项",
      keywords: "todo task rwlb db",
      icon: ListTodo,
      run: () => editor!.chain().focus().toggleTaskList().run(),
    },
    {
      id: "quote",
      title: "引用",
      hint: "让一句话更醒目",
      keywords: "quote yy",
      icon: Quote,
      run: () => editor!.chain().focus().toggleBlockquote().run(),
    },
    {
      id: "code",
      title: "代码块",
      hint: "保留代码与格式",
      keywords: "code dmk",
      icon: Code2,
      run: () => editor!.chain().focus().toggleCodeBlock().run(),
    },
    {
      id: "mermaid",
      title: "Mermaid 图表",
      hint: "用源码绘制流程图、时序图等",
      keywords: "mermaid diagram flowchart tb lct",
      icon: Workflow,
      run: () =>
        editor!
          .chain()
          .focus()
          .insertContent({
            type: "codeBlock",
            attrs: { language: "mermaid" },
            content: [
              { type: "text", text: "graph TD\n  A[开始] --> B[结束]" },
            ],
          })
          .run(),
    },
    {
      id: "table",
      title: "表格",
      hint: "插入三行三列表格",
      keywords: "table bg",
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
      keywords: "image tp",
      icon: ImagePlus,
      run: onImage,
    },
    {
      id: "divider",
      title: "分割线",
      hint: "为内容分个段落",
      keywords: "divider line fgx",
      icon: Minus,
      run: () => editor!.chain().focus().setHorizontalRule().run(),
    },
  ];
  const grouped = items
    .map((item) => ({
      ...item,
      group: ["emoji", "date", "reference"].includes(item.id)
        ? "插入"
        : ["callout", "fold", "image", "table"].includes(item.id)
          ? "内容块"
          : ["bullet", "ordered", "task"].includes(item.id)
            ? "列表"
            : "基础",
    }))
    .sort(
      (a, b) =>
        ["基础", "列表", "内容块", "插入"].indexOf(a.group) -
        ["基础", "列表", "内容块", "插入"].indexOf(b.group),
    );
  const filtered = grouped.filter(
    (item) =>
      (!menu?.inlineOnly || ["emoji", "date", "reference"].includes(item.id)) &&
      (!menu?.query ||
        `${item.title} ${item.keywords}`
          .toLowerCase()
          .includes(menu.query.toLowerCase())),
  );
  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      const { $from, empty, from } = editor.state.selection;
      if (
        !empty ||
        !["paragraph", "heading"].includes($from.parent.type.name)
      ) {
        setMenu(null);
        return;
      }
      const text = $from.parent.textBetween(0, $from.parentOffset);
      const match = /(?:^|\s)\/([^/\n]{0,24})$/.exec(text);
      if (!match) {
        setMenu(null);
        return;
      }
      const rect = editor.view.coordsAtPos(from);
      const placement = slashPlacement(
        rect.top,
        rect.bottom,
        window.innerHeight,
        420,
      );
      setMenu({
        from: from - match[1].length - 1,
        inlineOnly:
          match.index > 0 ||
          match[0].startsWith(" ") ||
          $from.parent.type.name !== "paragraph",
        to: from,
        query: match[1],
        x: Math.max(8, Math.min(rect.left, window.innerWidth - 290)),
        top: rect.top,
        bottom: rect.bottom,
        ...placement,
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
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const placement = slashPlacement(
      menu.top,
      menu.bottom,
      window.innerHeight,
      menuRef.current.scrollHeight,
    );
    if (placement.y !== menu.y || placement.maxHeight !== menu.maxHeight)
      setMenu((previous) => (previous ? { ...previous, ...placement } : null));
  }, [menu?.query, menu?.top, menu?.bottom]);
  const menuOpen = Boolean(menu);
  useEffect(() => {
    if (!menuOpen) return;
    const root = document.documentElement;
    const body = document.body;
    const previous = {
      rootOverflow: root.style.overflow,
      bodyOverflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
    };
    const scrollbarWidth = window.innerWidth - root.clientWidth;
    if (scrollbarWidth > 0)
      body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + scrollbarWidth}px`;
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    const resize = () => setMenu(null);
    window.addEventListener("resize", resize);
    return () => {
      root.style.overflow = previous.rootOverflow;
      body.style.overflow = previous.bodyOverflow;
      body.style.paddingRight = previous.paddingRight;
      window.removeEventListener("resize", resize);
    };
  }, [menuOpen]);
  useEffect(() => setSelected(0), [menu?.query]);
  const choose = (index: number) => {
    if (!editor || !menu || !filtered[index]) return;
    editor.chain().focus().deleteRange({ from: menu.from, to: menu.to }).run();
    filtered[index].run();
    setMenu(null);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!menu || event.isComposing) return false;
    if (["PageDown", "PageUp"].includes(event.key)) {
      event.preventDefault();
      return true;
    }
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
  return { menu, menuRef, filtered, selected, setSelected, choose, onKeyDown };
}
