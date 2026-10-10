import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { App, Dropdown, Input, Modal } from "antd";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { Markdown } from "@tiptap/markdown";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  FileText,
  ImagePlus,
  ListTree,
  LockKeyhole,
  Globe2,
  MoreHorizontal,
  Share2,
  Star,
  Upload,
  X,
} from "lucide-react";
import { Entry, useWorkspace } from "@/store/workspace";
import FileDialogs, { FileAction } from "@/components/FileDialogs";
import Formatting from "./components/Formatting";
import { useSlashMenu } from "./components/useSlashMenu";
import { samples } from "./content";
import styles from "./index.module.less";
const bubbleOptions = { placement: "top" as const, offset: 8 };
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
  const { message, modal } = App.useApp();
  const patch = useWorkspace((s) => s.patch);
  const visit = useWorkspace((s) => s.visit);
  const [title, setTitle] = useState(file.name);
  const [status, setStatus] = useState<"saved" | "saving" | "failed">("saved");
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [action, setAction] = useState<FileAction | null>(null);
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
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false },
      }),
      Placeholder.configure({ placeholder: "输入文字，或按 / 插入内容…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true } }),
      Image.configure({ allowBase64: true }),
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
  const slash = useSlashMenu(editor, () => imageInput.current?.click());
  keyHandler.current = slash.onKeyDown;
  useEffect(() => {
    visit(file.id);
    return () => clearTimeout(timer.current);
  }, [file.id, visit]);
  useEffect(() => {
    if (!slash.menu) return;
    const item = document.querySelector('[data-slash-selected="true"]');
    item?.scrollIntoView({ block: "nearest" });
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
  const exportMarkdown = () => {
    const data = editor.getMarkdown();
    const blob = new Blob([data], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title || "未命名文档").replace(/[\\/:*?"<>|]/g, "_")}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message.success("Markdown 已导出");
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
  return (
    <main className={styles.page}>
      <div className={styles.docHeader}>
        <button
          className="icon-button"
          aria-label="返回空间"
          onClick={() => navigate("/files")}
        >
          <ArrowLeft size={18} />
        </button>
        <FileText size={17} className={styles.docIcon} />
        <span className={styles.headerTitle}>{file.name}</span>
        <span className={styles.saveStatus} role="status">
          {status === "saved" && <Check size={12} />}{" "}
          {status === "saving"
            ? "保存中…"
            : status === "failed"
              ? "保存失败"
              : "已保存到本地"}
        </span>
        <div className={styles.headerActions}>
          <button
            className="icon-button"
            aria-label="收藏文档"
            aria-pressed={file.favorite}
            onClick={() => patch(file.id, { favorite: !file.favorite })}
          >
            <Star size={16} fill={file.favorite ? "currentColor" : "none"} />
          </button>
          <button
            className="icon-button"
            aria-label="切换文档目录"
            aria-pressed={outlineOpen}
            onClick={() => setOutlineOpen(!outlineOpen)}
          >
            <ListTree size={17} />
          </button>
          <button
            className="secondary-button"
            onClick={() => setAction({ type: "share", file })}
          >
            <Share2 size={14} />
            分享
          </button>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                {
                  key: "export",
                  label: "导出 Markdown",
                  icon: <Download size={15} />,
                },
                {
                  key: "import",
                  label: "导入 Markdown",
                  icon: <Upload size={15} />,
                },
              ],
              onClick: ({ key }) =>
                key === "export"
                  ? exportMarkdown()
                  : markdownInput.current?.click(),
            }}
          >
            <button className="icon-button" aria-label="文档更多操作">
              <MoreHorizontal size={18} />
            </button>
          </Dropdown>
        </div>
      </div>
      <div className={styles.toolbar}>
        <Formatting editor={editor} onLink={openLink} />
        <button
          className={styles.insertImage}
          onClick={() => imageInput.current?.click()}
          title="插入图片"
          aria-label="插入图片"
        >
          <ImagePlus size={16} />
        </button>
        {editor.isActive("table") && (
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: "row", label: "在下方插入行" },
                { key: "column", label: "在右侧插入列" },
                { key: "removeRow", label: "删除当前行" },
                { key: "removeColumn", label: "删除当前列" },
                { key: "remove", label: "删除表格", danger: true },
              ],
              onClick: ({ key }) => {
                const chain = editor.chain().focus();
                const commands: Record<string, () => boolean> = {
                  row: () => chain.addRowAfter().run(),
                  column: () => chain.addColumnAfter().run(),
                  removeRow: () => chain.deleteRow().run(),
                  removeColumn: () => chain.deleteColumn().run(),
                  remove: () => chain.deleteTable().run(),
                };
                commands[key]?.();
              },
            }}
          >
            <button className="secondary-button">
              表格操作
              <ChevronDown size={12} />
            </button>
          </Dropdown>
        )}
        <span className={styles.toolbarHint}>本地体验版</span>
      </div>
      <div
        className={`${styles.writingArea} ${!outlineOpen ? styles.noOutline : ""}`}
      >
        <article className={styles.paper}>
          <div className={styles.kicker}>A LITTLE ROOM FOR YOUR IDEAS</div>
          <input
            className={styles.title}
            aria-label="文档标题"
            value={title}
            maxLength={100}
            placeholder="未命名文档"
            onChange={(e) => {
              setTitle(e.target.value);
              save({ name: e.target.value.trim() || "未命名文档" });
            }}
            onBlur={() => {
              if (!title.trim()) setTitle("未命名文档");
            }}
          />
          <div className={styles.meta}>
            <span className={styles.avatar}>T</span>
            <span>Tingxi</span>
            <span className={styles.dot}>·</span>
            <span>
              {file.public ? <Globe2 size={12} /> : <LockKeyhole size={12} />}{" "}
              {file.public ? "公开分享" : "空间内可见"}
            </span>
          </div>
          <EditorContent editor={editor} className={styles.editor} />
          <div className={styles.paperFooter}>
            <span>{count} 字</span>
            <span>输入 / 插入内容 · 支持 Markdown 快捷输入</span>
          </div>
        </article>
        {outlineOpen && (
          <aside className={styles.outline}>
            <div>
              <ListTree size={14} />
              文档目录
              <button
                className="icon-button"
                aria-label="收起目录"
                onClick={() => setOutlineOpen(false)}
              >
                <X size={13} />
              </button>
            </div>
            <button
              className={styles.outlineTitle}
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            >
              {title || "未命名文档"}
            </button>
            {headings.map((h) => (
              <button
                key={h.pos}
                style={{ paddingLeft: 12 + (h.level - 1) * 12 }}
                onClick={() => {
                  const dom = editor.view.nodeDOM(h.pos);
                  if (dom instanceof HTMLElement)
                    dom.scrollIntoView({ behavior: "smooth", block: "center" });
                  editor.commands.setTextSelection(h.pos + 1);
                }}
              >
                {h.text}
              </button>
            ))}
            {!headings.length && <p>添加标题后，目录会出现在这里。</p>}
            <div className={styles.outlineNote}>
              安静地写，慢慢地想。
              <br />
              内容自动保存在此浏览器。
            </div>
          </aside>
        )}
      </div>
      <BubbleMenu editor={editor} options={bubbleOptions}>
        <div className={styles.bubble}>
          <Formatting editor={editor} compact onLink={openLink} />
        </div>
      </BubbleMenu>
      {slash.menu && (
        <div
          role="listbox"
          aria-label="插入内容"
          className={styles.slashMenu}
          style={{
            left: slash.menu.x,
            top: slash.menu.y,
            maxHeight: Math.max(110, window.innerHeight - slash.menu.y - 12),
          }}
        >
          <div className={styles.slashHeading}>
            插入内容 <span>↑ ↓ 选择 · Enter 插入</span>
          </div>
          {slash.filtered.map((item, i) => (
            <button
              role="option"
              aria-selected={slash.selected === i}
              data-slash-selected={slash.selected === i}
              key={item.id}
              onMouseDown={(e) => e.preventDefault()}
              className={slash.selected === i ? styles.slashSelected : ""}
              onClick={() => slash.choose(i)}
            >
              <span className={styles.commandIcon}>
                <item.icon size={18} />
              </span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.hint}</small>
              </span>
            </button>
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
