import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { App, Dropdown, Select } from "antd";
import {
  ArrowDown,
  PencilLine,
  FolderInput,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderPlus,
  Globe2,
  Grid2X2,
  List,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  Search,
  Share2,
  Star,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { useContextMenu } from "@/components/ContextMenu";
import FileIcon from "@/components/FileIcon";
import FileDialogs, { FileAction } from "@/components/FileDialogs";
import {
  Entry,
  FileKind,
  kindNames,
  spaces,
  useWorkspace,
} from "@/store/workspace";
import styles from "./index.module.less";
export default function Files() {
  const { files, space, patch, purge, add } = useWorkspace();
  const navigate = useNavigate();
  const contextMenu = useContextMenu();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const { message, modal } = App.useApp();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState<"list" | "grid">("list");
  const [action, setAction] = useState<FileAction | null>(null);
  const [sort, setSort] = useState<"updated" | "name">("updated");
  const upload = useRef<HTMLInputElement>(null);
  const folderId = params.get("folder");
  const folder = files.find(
    (f) =>
      f.id === folderId &&
      f.space === space &&
      f.kind === "folder" &&
      !f.deleted,
  );
  const parent = folder?.id || null;
  const isHome = pathname === "/files" && !folder;
  const trash = pathname === "/trash";
  useEffect(() => {
    setQuery("");
    setFilter("all");
  }, [pathname, space, folderId]);
  useEffect(() => {
    if (params.get("new") === "folder") {
      setAction({ type: "create", kind: "folder", parent });
      setParams(parent ? { folder: parent } : {}, { replace: true });
    }
  }, [params, parent, setParams]);
  const scope = files.filter((f) => f.space === space);
  const visible = scope
    .filter((f) => (trash ? f.deleted : !f.deleted))
    .filter((f) =>
      pathname === "/favorites"
        ? f.favorite
        : pathname === "/shared"
          ? f.public && f.kind !== "folder"
          : pathname === "/recent"
            ? f.kind !== "folder"
            : trash
              ? true
              : f.parent === parent,
    )
    .filter(
      (f) =>
        (filter === "all" || f.kind === filter) &&
        f.name.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name, "zh-CN")
        : Number(b.kind === "folder") - Number(a.kind === "folder") ||
          (pathname === "/recent"
            ? (b.accessed || b.updated).localeCompare(a.accessed || a.updated)
            : b.updated.localeCompare(a.updated)),
    );
  const title =
    folder?.name ||
    {
      "/files": "空间文件",
      "/recent": "最近访问",
      "/favorites": "我的收藏",
      "/shared": "公开分享",
      "/trash": "回收站",
    }[pathname] ||
    "空间文件";
  const open = (file: Entry) => {
    if (trash) return;
    navigate(
      file.kind === "folder"
        ? `/files?folder=${file.id}`
        : file.kind === "doc"
          ? `/document/${file.id}`
          : `/preview/${file.id}`,
    );
  };
  const remove = (file: Entry) => {
    if (files.some((f) => f.parent === file.id)) {
      message.info("请先移动或删除其下的文件");
      return;
    }
    modal.confirm({
      title: trash ? "永久删除这个文件？" : "移入回收站？",
      content: `${file.name}${trash ? "将从本地演示数据中永久移除。" : "可以在回收站恢复。"}`,
      okText: trash ? "永久删除" : "移入回收站",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => {
        if (trash) purge(file.id);
        else patch(file.id, { deleted: true });
        message.success(trash ? "已永久删除" : "已移入回收站");
      },
    });
  };
  const menu = (file: Entry) =>
    trash
      ? [
          { key: "restore", label: "恢复文件", icon: <Undo2 size={15} /> },
          {
            key: "delete",
            label: "永久删除",
            danger: true,
            icon: <Trash2 size={15} />,
          },
        ]
      : [
          {
            key: "open",
            label:
              file.kind === "folder"
                ? "打开文件夹"
                : file.kind === "doc"
                  ? "打开文档"
                  : "查看预览",
            icon: <ArrowRight size={15} />,
          },
          { key: "rename", label: "重命名", icon: <PencilLine size={15} /> },
          { key: "move", label: "移动到…", icon: <FolderInput size={15} /> },
          ...(file.kind !== "folder"
            ? [
                {
                  key: "favorite",
                  label: file.favorite ? "取消收藏" : "添加收藏",
                  icon: <Star size={15} />,
                },
                { key: "share", label: "分享设置", icon: <Share2 size={15} /> },
              ]
            : []),
          {
            key: "delete",
            label: "移入回收站",
            danger: true,
            icon: <Trash2 size={15} />,
          },
        ];
  const act = (key: string, file: Entry) => {
    if (key === "open") open(file);
    else if (key === "favorite") patch(file.id, { favorite: !file.favorite });
    else if (key === "restore") {
      patch(file.id, {
        deleted: false,
        parent: files.find((f) => f.id === file.parent && !f.deleted)
          ? file.parent
          : null,
      });
      message.success("文件已恢复");
    } else if (key === "delete") remove(file);
    else setAction({ type: key as "share" | "rename" | "move", file });
  };
  const newItems = (["doc", "sheet", "slide", "folder"] as FileKind[]).map(
    (kind) => ({
      key: kind,
      label: `新建${kindNames[kind]}`,
      icon: <FileIcon kind={kind} small />,
    }),
  );
  const imported = async (file?: File) => {
    if (!file) return;
    if (!/\.(md|markdown)$/i.test(file.name)) {
      message.warning("目前演示仅支持导入 .md 文件");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      message.warning("演示文件请小于 2MB");
      return;
    }
    const content = await file.text();
    add(file.name.replace(/\.(md|markdown)$/i, ""), "doc", parent, content);
    message.success("Markdown 已导入，可打开编辑");
  };
  return (
    <main className={styles.page}>
      <section className={styles.intro}>
        <div>
          {folder && (
            <button className={styles.back} onClick={() => navigate("/files")}>
              空间文件 <ChevronRight size={14} />
            </button>
          )}
          <h1>{title}</h1>
        </div>
        <div className={styles.introActions}>
          {!trash && (
            <>
              <button
                className="secondary-button"
                onClick={() => upload.current?.click()}
              >
                <Upload size={15} />
                导入
              </button>
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: newItems,
                  onClick: ({ key }) =>
                    setAction({
                      type: "create",
                      kind: key as FileKind,
                      parent,
                    }),
                }}
              >
                <button className="primary-button">
                  <Plus size={17} />
                  新建
                  <ChevronDown size={14} />
                </button>
              </Dropdown>
            </>
          )}
        </div>
      </section>
      <input
        hidden
        type="file"
        ref={upload}
        accept=".md,.markdown"
        onChange={(e) => {
          void imported(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <section className={styles.fileSection}>
        <div className={styles.sectionHeader}>
          <div className={styles.listTitle}>
            <h2>{isHome ? "空间里的文件" : "全部文件"}</h2>
            <span>{visible.length}</span>
          </div>
          <div className={styles.viewSwitch}>
            <button
              className={view === "list" ? styles.selected : ""}
              aria-label="列表视图"
              onClick={() => setView("list")}
            >
              <List size={17} />
            </button>
            <button
              className={view === "grid" ? styles.selected : ""}
              aria-label="网格视图"
              onClick={() => setView("grid")}
            >
              <Grid2X2 size={16} />
            </button>
          </div>
        </div>
        <div className={styles.toolbar}>
          <div className={styles.tabs}>
            {[
              { value: "all", label: "全部" },
              { value: "doc", label: "文档" },
              { value: "sheet", label: "表格" },
              { value: "slide", label: "幻灯片" },
            ].map((t) => (
              <button
                key={t.value}
                className={filter === t.value ? styles.activeTab : ""}
                onClick={() => setFilter(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className={styles.tools}>
            <div className={styles.inlineSearch}>
              <Search size={14} />
              <input
                aria-label="搜索文件"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索文件…"
              />
              {query && (
                <button
                  className="icon-button"
                  aria-label="清空搜索"
                  onClick={() => setQuery("")}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <Select
              variant="borderless"
              size="small"
              value={sort}
              onChange={setSort}
              options={[
                { value: "updated", label: "最近修改" },
                { value: "name", label: "名称排序" },
              ]}
            />
          </div>
        </div>
        {visible.length ? (
          <div className={view === "grid" ? styles.fileGrid : styles.fileList}>
            {view === "list" && (
              <div className={styles.tableHeader}>
                <span>
                  名称 <ArrowDown size={11} />
                </span>
                <span>可见性</span>
                <span>最近修改</span>
                <span>创建者</span>
                <span />
              </div>
            )}
            {visible.map((file) => (
              <div
                key={file.id}
                className={styles.fileRow}
                onContextMenu={(e) =>
                  contextMenu.open(
                    e,
                    menu(file).map((item) => ({
                      ...item,
                      run: () => act(item.key, file),
                    })),
                    "文件操作",
                  )
                }
              >
                <button
                  className={styles.fileName}
                  onClick={() => open(file)}
                  disabled={trash}
                >
                  <FileIcon kind={file.kind} small />
                  <span>{file.name}</span>
                  {file.favorite && file.kind !== "folder" && (
                    <Star
                      className={styles.favoriteMark}
                      size={12}
                      fill="currentColor"
                    />
                  )}
                </button>
                <span className={styles.visibility}>
                  {file.kind === "folder" ? (
                    <span className="muted">—</span>
                  ) : file.public ? (
                    <>
                      <Globe2 size={13} />
                      <span>公开</span>
                    </>
                  ) : (
                    <>
                      <LockKeyhole size={12} />
                      <span>私有</span>
                    </>
                  )}
                </span>
                <span className={styles.date}>
                  {new Date(file.updated).toLocaleDateString("zh-CN", {
                    month: "2-digit",
                    day: "2-digit",
                  })}
                  <small>今天</small>
                </span>
                <span className={styles.owner}>
                  <span className={styles.ownerAvatar}>T</span>
                  {file.owner}
                </span>
                <div className={styles.rowActions}>
                  {!trash && file.kind !== "folder" && (
                    <button
                      className="icon-button"
                      aria-label={`分享 ${file.name}`}
                      onClick={() => setAction({ type: "share", file })}
                    >
                      <Share2 size={15} />
                    </button>
                  )}
                  <button
                    className="icon-button"
                    aria-label={`更多操作 ${file.name}`}
                    onClick={(e) =>
                      contextMenu.openButton(
                        e,
                        menu(file).map((item) => ({
                          ...item,
                          run: () => act(item.key, file),
                        })),
                        "文件操作",
                      )
                    }
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <FolderPlus size={35} strokeWidth={1} />
            <h3>
              {query
                ? "没有找到匹配的文件"
                : trash
                  ? "回收站是空的"
                  : "这里还有很多可能"}
            </h3>
            <p>
              {query
                ? "试试其他关键词或文件类型"
                : trash
                  ? "删除的文件会暂存在这里"
                  : "新建一份文件，留下你的第一个想法"}
            </p>
            {!trash && !query && (
              <button
                className="secondary-button"
                onClick={() =>
                  setAction({ type: "create", kind: "doc", parent })
                }
              >
                <Plus size={15} />
                新建文档
              </button>
            )}
          </div>
        )}
      </section>
      {contextMenu.menu}
      <FileDialogs action={action} close={() => setAction(null)} />
    </main>
  );
}
