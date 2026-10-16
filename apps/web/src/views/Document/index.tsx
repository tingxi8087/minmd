import { isDemo, FullVersion } from "@/runtime";
import { copyText, readClipboardText } from "@/utils/clipboard";
import { usePageTitle } from "@/components/PageTitles";
import { UPLOAD_MAX_BYTES } from "@/utils/uploadLimits";
import { filesApi } from "@/api/files";
import { notifyFileAccessChanged } from "@/api/fileAccess";
import FileAccessGate from "@/components/FileAccessGate";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useBlocker } from "react-router-dom";
import { App, Input, Modal, Tooltip } from "antd";
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
import { shouldRecordDraft } from "./collaborationState";
import { useDocumentTitle } from "./useDocumentTitle";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import {
  useDocumentCollaboration,
  type DocumentSession,
  type CollaborationView,
} from "@/sessions/document";
import { documentApi } from "@/api/documents";
import { useAuth } from "@/store/auth";
import { errorMessage } from "@/http";
import { assetsApi } from "@/api/assets";
import { BlockId } from "./extensions/blockId";
import VersionHistory from "./components/VersionHistory";
import DocumentDetails from "./components/DocumentDetails";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import { DocumentImage } from "./components/DocumentImage";
import { Markdown } from "@tiptap/markdown";
import {
  ArrowLeft,
  Users,
  Check,
  CloudOff,
  LoaderCircle,
  CircleAlert,
  History,
  Palette,
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
import { type Entry, useWorkspace } from "@/store/workspace";
import FileDialogs, { type FileAction } from "@/components/FileDialogs";
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
import styles from "./index.module.less";
import { useLayout } from "@/store/layout";
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
  return (
    <FileAccessGate fileId={id ?? ""}>
      {(file) => <DocumentMode key={file.id} file={file} />}
    </FileAccessGate>
  );
}

function DocumentMode({ file }: { file: Entry }) {
  const collaboration = useDocumentCollaboration(file);
  const initialLoading =
    collaboration.view.notice === "正在连接文档…" ||
    collaboration.view.notice === "正在同步文档…";
  if (!collaboration.session?.loaded) {
    if (initialLoading)
      return (
        <div className={styles.documentLoading} role="status">
          正在加载文档…
        </div>
      );
    return (
      <div className={styles.verification} role="status">
        {collaboration.view.notice || "正在加载文档…"}
        <button className="secondary-button" onClick={collaboration.restart}>
          重新连接
        </button>
      </div>
    );
  }
  return (
    <DocumentEditor
      key={`${file.id}/${collaboration.session.epoch}`}
      file={file}
      session={collaboration.session}
      verification={collaboration.view}
      collaboration={collaboration}
    />
  );
}
function DocumentEditor({
  file,
  session,
  verification,
  collaboration,
}: {
  file: Entry;
  session: DocumentSession;
  verification: CollaborationView;
  collaboration: ReturnType<typeof useDocumentCollaboration>;
}) {
  const navigate = useNavigate();
  const contextMenu = useContextMenu();
  const { message, modal } = App.useApp();
  const patchStore = useWorkspace((s) => s.patch);
  const patch = async (id: string, value: Partial<Entry>) => {
    const workspace = useWorkspace.getState();
    if (
      workspace.space === file.space &&
      workspace.files.some((item) => item.id === id)
    )
      return patchStore(id, value);
    if (value.name !== undefined)
      await filesApi.rename(
        file.space,
        id,
        value.name,
        file.metadataRevision ?? 0,
      );
    if (value.favorite !== undefined)
      await filesApi.favorite(file.space, id, value.favorite);
    notifyFileAccessChanged(id);
  };
  const visit = useWorkspace((s) => s.visit);
  const [headerHost, setHeaderHost] = useState<HTMLElement | null>(null);
  useEffect(
    () => setHeaderHost(document.getElementById("document-header")),
    [],
  );
  const [title, setTitle] = useDocumentTitle(file.name);
  usePageTitle(title.trim() || "未命名文档", 2);
  const [status, setStatus] = useState<"saved" | "saving" | "failed">("saved");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [action, setAction] = useState<FileAction | null>(null);
  const [insertKind, setInsertKind] = useState<InsertKind | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [revision, setRevision] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const editorInitialized = useRef(false);
  const titleWrites = useRef<Promise<void>>(Promise.resolve());
  const imageInput = useRef<HTMLInputElement>(null);
  const markdownInput = useRef<HTMLInputElement>(null);
  const keyHandler = useRef<(e: KeyboardEvent) => boolean>(() => false);
  const save = (value: Partial<Entry>) => {
    setStatus("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      titleWrites.current = titleWrites.current
        .catch(() => {})
        .then(() => patch(file.id, value));
      void titleWrites.current
        .then(() => setStatus("saved"))
        .catch((error: unknown) => {
          setStatus("failed");
          message.error(errorMessage(error));
        });
    }, 500);
  };
  const checkpoint = async () => {
    if (isDemo) {
      message.info("演示模式，修改不会保存；可导出 Markdown 带走内容");
      return;
    }
    if (checkpointBusy) return;
    setCheckpointBusy(true);
    try {
      await collaboration.checkpoint();
      message.success("已保存并创建版本");
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setCheckpointBusy(false);
    }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void checkpoint();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [checkpointBusy, collaboration.checkpoint]);
  const blocker = useBlocker(() =>
    Boolean(useAuth.getState().user && session.pending),
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const dialog = modal.confirm({
      title: "修改尚未确认保存",
      content: "恢复草稿已保留在此浏览器。离开后可重新打开并检查草稿。",
      okText: "离开",
      cancelText: "继续编辑",
      onOk: () => blocker.proceed(),
      onCancel: () => blocker.reset(),
    });
    return () => dialog.destroy();
  }, [blocker.state]);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        undoRedo: session && !isDemo ? false : {},
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
      BlockId,
      HeadingCollapse.configure({
        storageKey: isDemo
          ? ""
          : `minmd-heading-fold/${session.scope.userId}/${file.id}`,
      }),
      TableDeletePreview,
      FontSize,
      Callout,
      Fold,
      DocumentReference,
      Markdown,
      ...(session && !isDemo
        ? [
            Collaboration.configure({ document: session.document }),
            CollaborationCaret.configure({
              provider: session.provider!,
              user: {
                name: session.userName,
                color: "#168b78",
              },
            }),
          ]
        : []),
    ],
    content: isDemo ? session.projection : undefined,
    contentType: "json",
    editable: verification.ready,
    onCreate: ({ editor }) => {
      editorInitialized.current = true;
      if (isDemo) {
        if (session.projection) editor.commands.setContent(session.projection);
      } else session.provider?.sendStateless("ready");
    },
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
    onUpdate: ({ editor, transaction }) => {
      if (!editorInitialized.current || !transaction.docChanged) return;
      const local = shouldRecordDraft(transaction);
      queueMicrotask(() => {
        if (editor.isDestroyed) return;
        if (local) collaboration.recordDraft(editor.getJSON());
        setRevision((value) => value + 1);
      });
    },
    onSelectionUpdate: () => setRevision((r) => r + 1),
  });
  useEffect(() => {
    editor?.setEditable(
      !session || (verification.ready && verification.connected),
      false,
    );
  }, [editor, session, verification.ready, verification.connected]);
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
    void visit(file.id).catch((error: unknown) =>
      message.error(errorMessage(error)),
    );
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
  const importMarkdown = async (importFile?: File) => {
    if (!importFile) return;
    if (
      !/\.(md|markdown)$/i.test(importFile.name) ||
      importFile.size > UPLOAD_MAX_BYTES
    ) {
      message.warning("请选择不超过 200 MB 的 Markdown 文件");
      return;
    }
    const text = await importFile.text();
    modal.confirm({
      title: "用导入内容替换正文？",
      content:
        "导入将替换正文并创建新版本，当前所有协作会话会重新打开。可在版本历史中恢复导入前的内容。",
      okText: "导入",
      cancelText: "取消",
      onOk: async () => {
        try {
          const projection = editor.markdown!.parse(text);
          const current = await documentApi.content(file.id);
          await documentApi.import(
            file.id,
            projection,
            current.revision,
            current.epoch,
          );
          collaboration.restart();
          message.success("Markdown 已导入并创建版本");
        } catch (error) {
          message.error(errorMessage(error));
          throw error;
        }
      },
    });
  };
  const insertImage = async (imageFile?: File) => {
    if (!imageFile) return;
    if (!verification.ready || !verification.connected) {
      message.warning("请先恢复文档连接");
      return;
    }
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        imageFile.type,
      ) ||
      imageFile.size > 1024 * 1024
    ) {
      message.warning("请选择小于 1MB 的 PNG、JPEG、WebP 或 GIF 图片");
      return;
    }
    const epoch = session.epoch;
    try {
      const asset = await assetsApi.upload(
        file.space,
        imageFile,
        undefined,
        file.id,
      );
      if (!editor.isDestroyed && session.epoch === epoch)
        editor
          .chain()
          .focus()
          .insertContent({
            type: "image",
            attrs: { src: asset.url, alt: imageFile.name, assetId: asset.id },
          })
          .run();
    } catch (error) {
      message.error(errorMessage(error));
    }
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
      key: "move",
      disabled: Boolean(file.permission && file.permission !== "manage"),
      label: "移动到…",
      icon: <FolderInput size={15} />,
      run: () => setAction({ type: "move", file }),
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
      run: () => setDetailsOpen(true),
    },
  ];
  const toggleFavorite = () => {
    void patch(file.id, { favorite: !file.favorite }).catch((error: unknown) =>
      message.error(errorMessage(error)),
    );
  };
  const headerItems = (): ContextItem[] =>
    window.matchMedia("(max-width: 680px)").matches
      ? [
          {
            key: "history",
            label: "版本历史",
            icon: <History size={15} />,
            run: () => setHistoryOpen(true),
          },
          {
            key: "favorite",
            label: file.favorite ? "取消收藏" : "添加收藏",
            icon: (
              <Star size={15} fill={file.favorite ? "currentColor" : "none"} />
            ),
            run: toggleFavorite,
          },
          {
            key: "theme",
            label: "主题设置",
            icon: <Palette size={15} />,
            run: () => useLayout.getState().setThemeDialogOpen(true),
          },
          { key: "header-divider", type: "divider" },
          ...documentItems(),
        ]
      : documentItems();
  const editingItems = (): ContextItem[] => {
    const { from, to, empty } = editor.state.selection;
    const copy = async (cut = false) => {
      try {
        await copyText(editor.state.doc.textBetween(from, to, "\n"));
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
          void readClipboardText()
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
  const saveNotice =
    status === "failed"
      ? "保存失败"
      : session
        ? verification.notice ||
          (!verification.connected
            ? "连接已断开"
            : verification.saved && status === "saved"
              ? "已保存到服务器"
              : "正在保存…")
        : status === "saving"
          ? "正在保存…"
          : "已保存";
  const saveProblem =
    status === "failed" ||
    Boolean(session && verification.notice && verification.ready);
  const SaveIcon = saveProblem
    ? CircleAlert
    : session && !verification.connected
      ? CloudOff
      : status === "saving" || (session && !verification.saved)
        ? LoaderCircle
        : Check;
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
      <div className={styles.headerActions}>
        <FullVersion>
          <Tooltip title={saveNotice} mouseEnterDelay={0.1}>
            <span
              className={styles.saveIndicator}
              role="status"
              aria-label={saveNotice}
              data-error={saveProblem}
            >
              {session && (verification.notice || !verification.connected) ? (
                <button
                  className="icon-button"
                  aria-label={`${saveNotice}，点击重新连接`}
                  onClick={() => collaboration.restart()}
                >
                  <SaveIcon size={16} />
                </button>
              ) : (
                <SaveIcon
                  size={16}
                  className={
                    SaveIcon === LoaderCircle ? styles.saving : undefined
                  }
                />
              )}
            </span>
          </Tooltip>
        </FullVersion>
        <FullVersion>
          <span className={styles.documentStats} aria-label="协作会话数量">
            <Users size={14} />
            {verification.count}/{verification.limit}
          </span>
        </FullVersion>
        <FullVersion>
          <TooltipButton
            className={`icon-button ${styles.headerSecondary}`}
            aria-label="版本历史"
            onClick={() => setHistoryOpen(true)}
          >
            <History size={17} />
          </TooltipButton>
        </FullVersion>
        <span className={styles.documentStats}>{count} 字</span>
        <FullVersion>
          <span className={styles.visibility}>
            {file.public ? <Globe2 size={13} /> : <LockKeyhole size={13} />}
            {file.public ? "公开" : "私有"}
          </span>
        </FullVersion>
        <TooltipButton
          className={`icon-button ${styles.headerSecondary}`}
          aria-label="收藏文档"
          aria-pressed={file.favorite}
          onClick={toggleFavorite}
        >
          <Star size={16} fill={file.favorite ? "currentColor" : "none"} />
        </TooltipButton>
        <FullVersion>
          <button
            className={`secondary-button ${styles.shareButton}`}
            aria-label="分享"
            onClick={() => setAction({ type: "share", file })}
          >
            <Share2 size={14} />
            <span className={styles.shareLabel}>分享</span>
          </button>
        </FullVersion>
        <TooltipButton
          className="icon-button"
          aria-label="文档更多操作"
          tooltip={contextMenu.menu ? "" : undefined}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) =>
            contextMenu.openButton(e, headerItems(), "文档操作", true)
          }
        >
          <MoreHorizontal size={18} />
        </TooltipButton>
      </div>
    </div>
  );
  return (
    <main className={styles.page}>
      {detailsOpen && (
        <DocumentDetails
          fileId={file.id}
          count={count}
          close={() => setDetailsOpen(false)}
        />
      )}
      {headerHost ? createPortal(documentHeader, headerHost) : documentHeader}
      {collaboration.drafts.length > 0 && (
        <div className={styles.verification} role="status">
          检测到未确认的恢复草稿（历史 epoch {collaboration.drafts[0].epoch}）
          <button
            className="secondary-button"
            onClick={() => {
              const draft = collaboration.drafts[0];
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(draft.projection, null, 2)], {
                  type: "application/json",
                }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = `${file.name}-恢复草稿.json`;
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            导出草稿
          </button>
          <button
            className="secondary-button"
            onClick={() => {
              void collaboration.dismissDraft(collaboration.drafts[0]);
            }}
          >
            忽略
          </button>
        </div>
      )}
      <VersionHistory
        file={file}
        open={historyOpen}
        close={() => setHistoryOpen(false)}
        onRestore={collaboration.restart}
        checkpoint={checkpoint}
        checkpointBusy={checkpointBusy}
      />
      <div
        className={styles.toolbar}
        ref={(element) => {
          if (element) element.inert = !verification.ready;
        }}
      >
        <Formatting
          editor={editor}
          onLink={openLink}
          mobileToolbar
          extra={
            <>
              <TooltipButton
                className={styles.insertImage}
                onClick={() => imageInput.current?.click()}
                aria-label="插入图片"
              >
                <ImagePlus size={16} />
                <span className={styles.moreLabel}>图片</span>
              </TooltipButton>
              <TooltipButton
                className={styles.insertImage}
                aria-label="插入表情"
                onClick={() => setInsertKind("emoji")}
              >
                <Smile size={16} />
                <span className={styles.moreLabel}>表情</span>
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
                      <span className={styles.moreLabel}>{name}</span>
                    </TooltipButton>
                  ))}
                  <TooltipButton
                    className={`${styles.insertImage} ${styles.deleteTable}`}
                    aria-label="删除整个表格"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => editor.chain().focus().deleteTable().run()}
                  >
                    <Trash2 size={15} />
                    <span className={styles.moreLabel}>删除表格</span>
                  </TooltipButton>
                </div>
              )}
            </>
          }
        />
      </div>
      <div className={styles.writingArea}>
        <article className={styles.paper}>
          <input
            className={styles.title}
            aria-label="文档标题"
            value={title}
            maxLength={200}
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
              const name = title.trim() || "未命名文档";
              setTitle(name);
              if (name !== file.name) {
                clearTimeout(timer.current);
                setStatus("saving");
                void (titleWrites.current = titleWrites.current
                  .catch(() => {})
                  .then(() => patch(file.id, { name })))
                  .then(() => setStatus("saved"))
                  .catch((error: unknown) => {
                    setStatus("failed");
                    message.error(errorMessage(error));
                  });
              }
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
          void insertImage(e.target.files?.[0]);
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
