import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { App, Input, Modal } from "antd";
import { EditorContent, useEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  TextStyle,
  Color,
  FontSize,
  BackgroundColor,
} from "@tiptap/extension-text-style";
import { hasCustomTextStyle } from "./utils/markdownExport";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import { DocumentImage } from "./components/DocumentImage";
import { Markdown } from "@tiptap/markdown";
import {
  ArrowLeft,
  PencilLine,
  FolderInput,
  Undo2,
  Redo2,
  Copy,
  Scissors,
  ClipboardPaste,
  TextSelect,
  Info,
  ChevronDown,
  Download,
  FileText,
  ImagePlus,
  Smile,
  ListTree,
  LockKeyhole,
  Globe2,
  MoreHorizontal,
  Share2,
  Star,
  Upload,
  PanelRightClose,
  PanelRightOpen,
  Trash2,
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
} from "lucide-react";
import { Entry, useWorkspace } from "@/store/workspace";
import FileDialogs, { FileAction } from "@/components/FileDialogs";
import { useContextMenu, type ContextItem } from "@/components/ContextMenu";
import TooltipButton from "@/components/TooltipButton";
import InsertPicker, { type InsertKind } from "./components/InsertPicker";
import TableContextMenu from "./components/TableContextMenu";
import { TableDeletePreview } from "./extensions/tableDeletePreview";
import { QuickTableView } from "./extensions/QuickTableView";
import { HeadingCollapse, revealHeading } from "./extensions/headingCollapse";
import { Callout, Fold, DocumentReference } from "./extensions/blocks";
import { exportDocument, hasCustomBlocks } from "./utils/markdownExport";
import { SelectableCodeBlock } from "./components/CodeBlock";
import Formatting from "./components/Formatting";
import { useSlashMenu } from "./components/useSlashMenu";
import { samples } from "./content";
import styles from "./index.module.less";
const shouldShowFormatting: NonNullable<
  React.ComponentProps<typeof BubbleMenu>["shouldShow"]
> = ({ editor, view, state, from, to, element }) => {
  if (
    !editor.isEditable ||
    state.selection.empty ||
    !state.doc.textBetween(from, to).length ||
    (!view.hasFocus() && !element.contains(document.activeElement))
  )
    return false;
  let containsCode = editor.isActive("codeBlock");
  state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === "codeBlock") containsCode = true;
  });
  return !containsCode;
};
const bubbleContainer = () => document.body;
export default function Document() {
  const { id } = useParams();
  const space = useWorkspace((s) => s.space);
  const file = useWorkspace((s) =>
    s.files.find(
      (f) => f.id === id && f.space === space && f.kind === "doc" && !f.deleted,
    ),
  );
  const navigate = useNavigate();
  if (!file)
    return (
      <div className={styles.notFound}>
        <FileText size={30} />
        <h2>文档不存在或不在当前空间</h2>
        <button className="secondary-button" onClick={() => navigate("/files")}>
          返回空间
        </button>
      </div>
    );
  return <DocumentEditor key={file.id} file={file} />;
}
function DocumentEditor({ file }: { file: Entry }) {
  const navigate = useNavigate();
  const contextMenu = useContextMenu();
  const { message, modal } = App.useApp();
  const patch = useWorkspace((s) => s.patch);
  const visit = useWorkspace((s) => s.visit);
  const [headerHost, setHeaderHost] = useState<HTMLElement | null>(null);
  useEffect(
    () => setHeaderHost(document.getElementById("document-header")),
    [],
  );
  const [title, setTitle] = useState(file.name);
  const [status, setStatus] = useState<"saved" | "saving" | "failed">("saved");
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [action, setAction] = useState<FileAction | null>(null);
  const [insertKind, setInsertKind] = useState<InsertKind | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [revision, setRevision] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const imageInput = useRef<HTMLInputElement>(null);
  const markdownInput = useRef<HTMLInputElement>(null);
  const keyHandler = useRef<(e: KeyboardEvent) => boolean>(() => false);
  const save = (value: Partial<Entry>) => {
    setStatus("saving");
    clearTimeout(timer.current);
    try {
      patch(file.id, value);
      timer.current = setTimeout(() => setStatus("saved"), 450);
    } catch {
      setStatus("failed");
      message.error("本地保存失败，可能是浏览器存储空间不足。请导出备份。");
    }
  };
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        link: { openOnClick: false },
      }),
      SelectableCodeBlock,
      Placeholder.configure({ placeholder: "输入文字，或按 / 插入内容…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true, View: QuickTableView } }),
      DocumentImage,
      TextStyle,
      Color,
      BackgroundColor,
      HeadingCollapse,
      TableDeletePreview,
      FontSize,
      Callout,
      Fold,
      DocumentReference,
      Markdown,
    ],
    content: file.document || file.content || samples[file.id] || "",
    contentType: file.document ? "json" : "markdown",
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "文档正文",
        "aria-multiline": "true",
        spellcheck: "false",
      },
      handleKeyDown: (_view, event) => keyHandler.current(event),
    },
    onUpdate: ({ editor }) => {
      save({ document: editor.getJSON(), contentVersion: 1 });
      setRevision((r) => r + 1);
    },
    onSelectionUpdate: () => setRevision((r) => r + 1),
  });
  const slash = useSlashMenu(
    editor,
    () => imageInput.current?.click(),
    setInsertKind,
  );
  const bubbleOptions = useMemo(
    () => ({
      placement: "top" as const,
      strategy: "fixed" as const,
      offset: 8,
      shift: { boundary: editor?.view.dom, padding: 8 },
    }),
    [editor],
  );
  keyHandler.current = slash.onKeyDown;
  useEffect(() => {
    visit(file.id);
    return () => clearTimeout(timer.current);
  }, [file.id, visit]);
  useEffect(() => {
    if (!slash.menu) return;
    const item = document.querySelector<HTMLElement>(
      '[data-slash-selected="true"]',
    );
    const container = slash.menuRef.current;
    if (item && container) {
      const top = item.offsetTop;
      const bottom = top + item.offsetHeight;
      if (top < container.scrollTop) container.scrollTop = top;
      else if (bottom > container.scrollTop + container.clientHeight)
        container.scrollTop = bottom - container.clientHeight;
    }
  }, [slash.selected, slash.menu?.query]);
  if (!editor) return null;
  const headings: { text: string; level: number; pos: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading")
      headings.push({
        text: node.textContent || "未命名标题",
        level: node.attrs.level,
        pos,
      });
  });
  const count = editor.getText().replace(/\s/g, "").length;
  void revision;
  const downloadMarkdown = () => {
    const data = editor.markdown!.serialize(
      exportDocument(
        editor.getJSON(),
        (id) => useWorkspace.getState().files.find((f) => f.id === id)?.name,
      ),
    );
    const blob = new Blob([data], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title || "未命名文档").replace(/[\\/:*?"<>|]/g, "_")}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message.success("Markdown 已导出");
  };
  const exportMarkdown = () => {
    if (
      !hasCustomTextStyle(editor.getJSON()) &&
      !hasCustomBlocks(editor.getJSON())
    )
      return downloadMarkdown();
    modal.confirm({
      title: "导出 Markdown",
      content:
        "Markdown 导出会移除自定义字体颜色、背景颜色和字号，将高亮块转成引用、折叠块展开为标题及内容，文档引用转成链接。原文档不受影响。",
      okText: "继续导出",
      cancelText: "取消",
      onOk: downloadMarkdown,
    });
  };
  const importMarkdown = async (file?: File) => {
    if (!file) return;
    if (!/\.(md|markdown)$/i.test(file.name) || file.size > 2 * 1024 * 1024) {
      message.warning("请选择小于 2MB 的 Markdown 文件");
      return;
    }
    const text = await file.text();
    modal.confirm({
      title: "用导入内容替换正文？",
      content: "标题保持不变。可使用撤销恢复替换前的正文。",
      okText: "导入",
      cancelText: "取消",
      onOk: () => {
        editor.commands.setContent(text, { contentType: "markdown" });
        message.success("Markdown 已转成可编辑正文");
      },
    });
  };
  const insertImage = (file?: File) => {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.type,
      ) ||
      file.size > 1024 * 1024
    ) {
      message.warning("请选择小于 1MB 的 PNG、JPEG、WebP 或 GIF 图片");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      editor
        .chain()
        .focus()
        .setImage({ src: String(reader.result), alt: file.name })
        .run();
    reader.onerror = () => message.error("图片读取失败");
    reader.readAsDataURL(file);
  };
  const openLink = () => {
    setLink(editor.getAttributes("link").href || "");
    setLinkOpen(true);
  };
  const applyLink = () => {
    if (!link.trim())
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else {
      let url: URL;
      try {
        url = new URL(link.trim());
      } catch {
        message.warning("请输入完整链接，例如 https://example.com");
        return;
      }
      if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
        message.warning("仅支持 http、https 或邮件链接");
        return;
      }
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url.href })
        .run();
    }
    setLinkOpen(false);
  };
  const documentItems = (): ContextItem[] => [
    {
      key: "rename",
      label: "重命名",
      icon: <PencilLine size={15} />,
      run: () => setAction({ type: "rename", file }),
    },
    {
      key: "move",
      label: "移动到…",
      icon: <FolderInput size={15} />,
      run: () => setAction({ type: "move", file }),
    },
    {
      key: "favorite",
      label: file.favorite ? "取消收藏" : "添加收藏",
      icon: <Star size={15} />,
      run: () => patch(file.id, { favorite: !file.favorite }),
    },
    {
      key: "share",
      label: "分享设置",
      icon: <Share2 size={15} />,
      run: () => setAction({ type: "share", file }),
    },
    { key: "divider", type: "divider" },
    {
      key: "export",
      label: "导出 Markdown",
      icon: <Download size={15} />,
      run: exportMarkdown,
    },
    {
      key: "import",
      label: "导入 Markdown",
      icon: <Upload size={15} />,
      run: () => markdownInput.current?.click(),
    },
    {
      key: "details",
      label: "文档详情",
      icon: <Info size={15} />,
      run: () =>
        modal.info({
          title: "文档详情",
          content: (
            <div>
              <p>作者：{file.owner}</p>
              <p>可见性：{file.public ? "公开" : "私有"}</p>
              <p>字数：{count}</p>
            </div>
          ),
          okText: "关闭",
        }),
    },
  ];
  const editingItems = (): ContextItem[] => {
    const { from, to, empty } = editor.state.selection;
    const copy = async (cut = false) => {
      try {
        await navigator.clipboard.writeText(
          editor.state.doc.textBetween(from, to, "\n"),
        );
        if (cut) editor.chain().focus().deleteRange({ from, to }).run();
      } catch {
        message.info("无法访问剪贴板，请使用键盘快捷键。");
      }
    };
    return [
      {
        key: "undo",
        label: "撤销",
        icon: <Undo2 size={15} />,
        disabled: !editor.can().undo(),
        run: () => {
          editor.chain().focus().undo().run();
        },
      },
      {
        key: "redo",
        label: "重做",
        icon: <Redo2 size={15} />,
        disabled: !editor.can().redo(),
        run: () => {
          editor.chain().focus().redo().run();
        },
      },
      { key: "edit-divider", type: "divider" },
      {
        key: "copy",
        label: "复制",
        icon: <Copy size={15} />,
        disabled: empty,
        run: () => {
          void copy();
        },
      },
      {
        key: "cut",
        label: "剪切",
        icon: <Scissors size={15} />,
        disabled: empty,
        run: () => {
          void copy(true);
        },
      },
      {
        key: "paste",
        label: "粘贴纯文本",
        icon: <ClipboardPaste size={15} />,
        run: () => {
          void navigator.clipboard
            .readText()
            .then((text) => {
              if (text)
                editor
                  .chain()
                  .focus()
                  .insertContent(
                    /[\r\n]/.test(text)
                      ? text.split(/\r?\n/).map((line) => ({
                          type: "paragraph",
                          content: line ? [{ type: "text", text: line }] : [],
                        }))
                      : { type: "text", text },
                  )
                  .run();
            })
            .catch(() => message.info("无法访问剪贴板，请使用键盘快捷键。"));
        },
      },
      {
        key: "select",
        label: "全选正文",
        icon: <TextSelect size={15} />,
        run: () => {
          editor.chain().focus().selectAll().run();
        },
      },
      { key: "doc-divider", type: "divider" },
      ...documentItems().filter((item) =>
        ["share", "export"].includes(item.key),
      ),
    ];
  };
  const documentHeader = (
    <div className={styles.docHeader}>
      <TooltipButton
        className="icon-button"
        aria-label="返回空间"
        onClick={() => navigate("/files")}
      >
        <ArrowLeft size={18} />
      </TooltipButton>
      <FileText size={17} className={styles.docIcon} />
      <span className={styles.headerTitle}>{file.name}</span>
      {status !== "saved" && (
        <span className={styles.saveStatus} role="status">
          {status === "saving" ? "保存中…" : "保存失败"}
        </span>
      )}
      <div className={styles.headerActions}>
        <span className={styles.documentStats}>{count} 字</span>
        <span className={styles.visibility}>
          {file.public ? <Globe2 size={13} /> : <LockKeyhole size={13} />}
          {file.public ? "公开" : "私有"}
        </span>
        <TooltipButton
          className="icon-button"
          aria-label="收藏文档"
          aria-pressed={file.favorite}
          onClick={() => patch(file.id, { favorite: !file.favorite })}
        >
          <Star size={16} fill={file.favorite ? "currentColor" : "none"} />
        </TooltipButton>
        <TooltipButton
          className="icon-button"
          aria-label={outlineOpen ? "收起文档目录" : "展开文档目录"}
          aria-expanded={outlineOpen}
          aria-controls="document-outline"
          onClick={() => setOutlineOpen(!outlineOpen)}
        >
          {outlineOpen ? (
            <PanelRightClose size={17} />
          ) : (
            <PanelRightOpen size={17} />
          )}
        </TooltipButton>
        <button
          className="secondary-button"
          onClick={() => setAction({ type: "share", file })}
        >
          <Share2 size={14} />
          分享
        </button>
        <TooltipButton
          className="icon-button"
          aria-label="文档更多操作"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) =>
            contextMenu.openButton(e, documentItems(), "文档操作", true)
          }
        >
          <MoreHorizontal size={18} />
        </TooltipButton>
      </div>
    </div>
  );
  return (
    <main className={styles.page}>
      {headerHost ? createPortal(documentHeader, headerHost) : documentHeader}
      <div className={styles.toolbar}>
        <Formatting editor={editor} onLink={openLink} />
        <TooltipButton
          className={styles.insertImage}
          onClick={() => imageInput.current?.click()}
          aria-label="插入图片"
        >
          <ImagePlus size={16} />
        </TooltipButton>
        <TooltipButton
          className={styles.insertImage}
          aria-label="插入表情"
          onClick={() => setInsertKind("emoji")}
        >
          <Smile size={16} />
        </TooltipButton>
        {editor.isActive("table") && (
          <div className={styles.tableControls}>
            {[
              {
                name: "在上方插入行",
                Icon: ArrowUpToLine,
                run: () => editor.chain().focus().addRowBefore().run(),
              },
              {
                name: "在下方插入行",
                Icon: ArrowDownToLine,
                run: () => editor.chain().focus().addRowAfter().run(),
              },
              {
                name: "在左侧插入列",
                Icon: ArrowLeftToLine,
                run: () => editor.chain().focus().addColumnBefore().run(),
              },
              {
                name: "在右侧插入列",
                Icon: ArrowRightToLine,
                run: () => editor.chain().focus().addColumnAfter().run(),
              },
            ].map(({ name, Icon, run }) => (
              <TooltipButton
                key={name}
                className={styles.insertImage}
                aria-label={name}
                onMouseDown={(e) => e.preventDefault()}
                onClick={run}
              >
                <Icon size={16} />
              </TooltipButton>
            ))}
            <TooltipButton
              className={`${styles.insertImage} ${styles.deleteTable}`}
              aria-label="删除整个表格"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().deleteTable().run()}
            >
              <Trash2 size={15} />
            </TooltipButton>
          </div>
        )}
      </div>
      <div className={styles.writingArea}>
        <article className={styles.paper}>
          <input
            className={styles.title}
            aria-label="文档标题"
            value={title}
            maxLength={100}
            placeholder="未命名文档"
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                editor.commands.focus("start");
              }
            }}
            onChange={(e) => {
              setTitle(e.target.value);
              save({ name: e.target.value.trim() || "未命名文档" });
            }}
            onBlur={() => {
              if (!title.trim()) setTitle("未命名文档");
            }}
          />
          <EditorContent
            editor={editor}
            className={styles.editor}
            onContextMenu={(e) => {
              if (
                e.defaultPrevented ||
                (e.target as Element).closest("td,th,input,button")
              )
                return;
              const hit = editor.view.posAtCoords({
                left: e.clientX,
                top: e.clientY,
              });
              const selection = editor.state.selection;
              if (
                hit &&
                (selection.empty ||
                  hit.pos < selection.from ||
                  hit.pos > selection.to)
              )
                editor.view.dispatch(
                  editor.state.tr.setSelection(
                    TextSelection.near(editor.state.doc.resolve(hit.pos)),
                  ),
                );
              editor.view.focus();
              contextMenu.open(e, editingItems(), "文档右键菜单", true);
            }}
          />
        </article>
        <aside
          className={`${styles.outline} ${!outlineOpen ? styles.outlineCollapsed : ""}`}
          aria-label="文档目录"
        >
          <div className={styles.outlineHeader}>
            <span className={styles.outlineHeading} aria-hidden={!outlineOpen}>
              <ListTree size={14} />
              文档目录
            </span>
            <TooltipButton
              className="icon-button"
              aria-label={outlineOpen ? "收起目录" : "展开目录"}
              aria-expanded={outlineOpen}
              aria-controls="document-outline"
              onClick={() => setOutlineOpen((open) => !open)}
            >
              {outlineOpen ? (
                <PanelRightClose size={15} />
              ) : (
                <PanelRightOpen size={15} />
              )}
            </TooltipButton>
          </div>
          <div
            id="document-outline"
            className={styles.outlineContent}
            aria-hidden={!outlineOpen}
          >
            <button
              tabIndex={outlineOpen ? 0 : -1}
              className={styles.outlineTitle}
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            >
              {title || "未命名文档"}
            </button>
            {headings.map((h) => (
              <button
                key={h.pos}
                tabIndex={outlineOpen ? 0 : -1}
                style={{ paddingLeft: 12 + (h.level - 1) * 8 }}
                onClick={() => {
                  revealHeading(editor, h.pos);
                  const dom = editor.view.nodeDOM(h.pos);
                  if (dom instanceof HTMLElement)
                    dom.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              >
                {h.text}
              </button>
            ))}
            {!headings.length && <p>添加标题后，目录会出现在这里。</p>}
          </div>
        </aside>
      </div>
      <BubbleMenu
        editor={editor}
        options={bubbleOptions}
        shouldShow={shouldShowFormatting}
        appendTo={bubbleContainer}
        className={styles.bubbleLayer}
      >
        <div className={styles.bubble}>
          <Formatting editor={editor} compact onLink={openLink} />
        </div>
      </BubbleMenu>
      {slash.menu && (
        <div
          role="listbox"
          ref={slash.menuRef}
          aria-label="插入内容"
          className={styles.slashMenu}
          style={{
            left: slash.menu.x,
            top: slash.menu.y,
            maxHeight: slash.menu.maxHeight,
          }}
        >
          <div className={styles.slashHeading}>
            插入内容 <span>↑ ↓ 选择 · Enter 插入</span>
          </div>
          {slash.filtered.map((item, i) => (
            <div key={item.id}>
              {(!i || slash.filtered[i - 1].group !== item.group) && (
                <div className={styles.slashGroup}>{item.group}</div>
              )}
              <button
                role="option"
                aria-selected={slash.selected === i}
                data-slash-selected={slash.selected === i}
                key={item.id}
                onMouseDown={(e) => e.preventDefault()}
                className={slash.selected === i ? styles.slashSelected : ""}
                onMouseEnter={() => slash.setSelected(i)}
                onClick={() => slash.choose(i)}
              >
                <span className={styles.commandIcon}>
                  <item.icon size={18} />
                </span>
                <span>
                  <strong>{item.title}</strong>
                </span>
              </button>
            </div>
          ))}
          {!slash.filtered.length && <p>没有匹配的内容类型</p>}
        </div>
      )}
      <input
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp,image/gif"
        ref={imageInput}
        onChange={(e) => {
          insertImage(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        type="file"
        hidden
        accept=".md,.markdown"
        ref={markdownInput}
        onChange={(e) => {
          void importMarkdown(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <InsertPicker
        kind={insertKind}
        editor={editor}
        fileId={file.id}
        close={() => setInsertKind(null)}
      />
      {contextMenu.menu}
      <TableContextMenu editor={editor} />
      <FileDialogs action={action} close={() => setAction(null)} />
      <Modal
        title="插入链接"
        open={linkOpen}
        onCancel={() => setLinkOpen(false)}
        onOk={applyLink}
        okText="应用"
        cancelText="取消"
      >
        <div className="field">
          <label>链接地址</label>
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://example.com"
            onPressEnter={applyLink}
          />
          <p className="dialog-note">清空地址可移除选中文字的链接。</p>
        </div>
      </Modal>
    </main>
  );
}
