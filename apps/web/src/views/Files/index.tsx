import FileTransferDialog, {
  type TransferAction,
} from "@/components/FileTransferDialog";
import { isDemo, FullVersion } from "@/runtime";
import { usePageTitle } from "@/components/PageTitles";
import axios from "axios";
import { lazy, Suspense, useEffect, useState } from "react";
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
import FileDialogs, { type FileAction } from "@/components/FileDialogs";
import {
  type Entry,
  type FileKind,
  kindNames,
  useWorkspace,
} from "@/store/workspace";
import { errorMessage } from "@/http";
import { useAuth } from "@/store/auth";
import styles from "./index.module.less";
import { loadCreatorNames, creatorName } from "./creators";
const DemoImport = lazy(() => import("@/components/DemoImport"));
export default function Files() {
  const {
    files,
    space,
    spaces,
    patch,
    purge,
    filesLoading,
    filesError,
    loadFiles,
  } = useWorkspace();
  const user = useAuth((state) => state.user);
  const creatorScope = `${user?.id ?? ""}/${space}`;
  const [creators, setCreators] = useState<{
    scope: string;
    names: Record<string, string>;
    loaded: boolean;
    failed: boolean;
  }>({ scope: "", names: {}, loaded: false, failed: false });
  useEffect(() => {
    const controller = new AbortController();
    setCreators({
      scope: creatorScope,
      names: {},
      loaded: false,
      failed: false,
    });
    if (user && space)
      void loadCreatorNames(space, controller.signal)
        .then((names) => {
          if (!controller.signal.aborted)
            setCreators({
              scope: creatorScope,
              names,
              loaded: true,
              failed: false,
            });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setCreators({
              scope: creatorScope,
              names: {},
              loaded: true,
              failed: true,
            });
        });
    return () => controller.abort();
  }, [creatorScope, space, user?.id]);
  const creator = (id: string) =>
    creatorName(
      id,
      creators.scope === creatorScope ? creators.names : {},
      creators.scope === creatorScope && creators.loaded,
      creators.scope === creatorScope && creators.failed,
    );
  const owner = spaces.find((item) => item.id === space)?.ownerId === user?.id;
  const navigate = useNavigate();
  const contextMenu = useContextMenu();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const { message, modal } = App.useApp();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState<"list" | "grid">("list");
  const [action, setAction] = useState<FileAction | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [transferAction, setTransferAction] = useState<TransferAction | null>(
    null,
  );
  const [sort, setSort] = useState<"updated" | "name">("updated");
  const [demoImportOpen, setDemoImportOpen] = useState(false);
  const folderId = params.get("folder");
  const folder = files.find(
    (f) =>
      f.id === folderId &&
      f.space === space &&
      f.kind === "folder" &&
      !f.deleted,
  );
  const currentSpaceName = spaces.find((item) => item.id === space)?.name;
  usePageTitle(
    folder ? [folder.name, currentSpaceName].filter(Boolean).join(" · ") : null,
  );
  const parent = folder?.id || null;
  useEffect(() => {
    setSelectedIds([]);
    setSelecting(false);
    setTransferAction(null);
  }, [space, parent, pathname, user]);
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
  const selected = selectedIds.filter((id) =>
    visible.some((file) => file.id === id),
  );
  const toggleSelected = (id: string) =>
    setSelectedIds((ids) =>
      ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
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
    if (selecting) {
      toggleSelected(file.id);
      return;
    }
    navigate(
      file.kind === "folder"
        ? `/files?folder=${file.id}`
        : file.kind === "doc"
          ? `/document/${file.id}`
          : `/preview/${file.id}`,
    );
  };
  const remove = (file: Entry) => {
    modal.confirm({
      title: trash ? "永久删除这个文件？" : "移入回收站？",
      content: `${file.name}${trash ? "及其子文件将被永久移除。" : "及其子文件可以在回收站恢复。"}`,
      okText: trash ? "永久删除" : "移入回收站",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          if (trash) await purge(file.id);
          else await patch(file.id, { deleted: true });
          message.success(trash ? "已永久删除" : "已移入回收站");
        } catch (error) {
          message.error(errorMessage(error));
          throw error;
        }
      },
    });
  };
  const menu = (file: Entry) =>
    trash
      ? [
          {
            key: "restore",
            disabled: Boolean(file.permission && file.permission !== "manage"),
            label: "恢复文件",
            icon: <Undo2 size={15} />,
          },
          ...(owner
            ? [
                {
                  key: "delete",
                  disabled: Boolean(
                    file.permission && file.permission !== "manage",
                  ),
                  label: "永久删除",
                  danger: true,
                  icon: <Trash2 size={15} />,
                },
              ]
            : []),
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
          {
            key: "rename",
            disabled: file.permission === "read",
            label: "重命名",
            icon: <PencilLine size={15} />,
          },
          {
            key: "move",
            disabled: Boolean(file.permission && file.permission !== "manage"),
            label: "移动到…",
            icon: <FolderInput size={15} />,
          },
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
            disabled: Boolean(file.permission && file.permission !== "manage"),
            label: "移入回收站",
            danger: true,
            icon: <Trash2 size={15} />,
          },
        ];
  const act = async (key: string, file: Entry) => {
    try {
      if (key === "open") open(file);
      else if (key === "favorite")
        await patch(file.id, { favorite: !file.favorite });
      else if (key === "restore") {
        try {
          await patch(file.id, { deleted: false });
          message.success("文件已恢复");
        } catch (error) {
          if (axios.isAxiosError(error) && error.response?.status === 409) {
            setAction({ type: "restore", file });
            message.info("原位置无法恢复，请选择新位置");
          } else throw error;
        }
      } else if (key === "delete") remove(file);
      else setAction({ type: key as "share" | "rename" | "move", file });
    } catch (error) {
      message.error(errorMessage(error));
    }
  };
  const newItems: { key: string; label: string; icon: React.ReactNode }[] = (
    ["doc", "sheet", "folder"] as FileKind[]
  ).map((kind) => ({
    key: kind,
    label: `新建${kindNames[kind]}`,
    icon: <FileIcon kind={kind} small />,
  }));
  newItems.splice(2, 0, {
    key: "upload",
    label: "上传文件",
    icon: <Upload size={17} />,
  });
  return (
    <main className={styles.page}>
      {filesLoading && <p role="status">正在加载文件…</p>}
      {filesError && (
        <p role="alert">
          {filesError}{" "}
          <button className="secondary-button" onClick={() => void loadFiles()}>
            重试
          </button>
        </p>
      )}
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
            <FullVersion feature="批量导出">
              <button
                className="secondary-button"
                onClick={() => {
                  setSelecting((value) => !value);
                  setSelectedIds([]);
                }}
              >
                {selecting ? "退出选择" : "选择"}
              </button>
            </FullVersion>
          )}
          {!trash && (
            <>
              <button
                className="secondary-button"
                onClick={() => setAction({ type: "upload", parent })}
              >
                <Upload size={15} />
                上传文件
              </button>
              <FullVersion>
                <button
                  className="secondary-button"
                  onClick={() => setDemoImportOpen(true)}
                >
                  导入旧演示
                </button>
              </FullVersion>
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: newItems,
                  onClick: ({ key }) =>
                    setAction(
                      key === "upload"
                        ? { type: "upload", parent }
                        : {
                            type: "create",
                            kind: key as FileKind,
                            parent,
                          },
                    ),
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
      {selecting && (
        <div className={styles.selectionBar}>
          <label>
            <input
              type="checkbox"
              aria-label="全选当前列表"
              checked={visible.length > 0 && selected.length === visible.length}
              onChange={(event) =>
                setSelectedIds(
                  event.target.checked ? visible.map((file) => file.id) : [],
                )
              }
            />
            全选当前列表
          </label>
          <span>已选 {selected.length} 项</span>
          <button
            className="secondary-button"
            disabled={!selected.length}
            onClick={() => setSelectedIds([])}
          >
            清空
          </button>
          <button
            className="primary-button"
            disabled={!selected.length}
            onClick={() =>
              setTransferAction({
                type: "export",
                spaceId: space,
                ids: selected,
              })
            }
          >
            导出选中
          </button>
        </div>
      )}
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
              { value: "pdf", label: "PDF" },
              { value: "video", label: "视频" },
              { value: "image", label: "图片" },
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
          <div
            data-demo={isDemo || undefined}
            className={view === "grid" ? styles.fileGrid : styles.fileList}
          >
            {view === "list" && (
              <div className={styles.tableHeader}>
                <span>
                  名称 <ArrowDown size={11} />
                </span>
                <FullVersion>
                  <span>可见性</span>
                </FullVersion>
                <span>最近修改</span>
                <span>创建者</span>
                <span />
              </div>
            )}
            {visible.map((file) => (
              <div
                key={file.id}
                className={`${styles.fileRow} ${selecting ? styles.selectable : ""}`}
                data-selected={selected.includes(file.id) || undefined}
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
                {selecting && (
                  <input
                    type="checkbox"
                    className={styles.selectionCheckbox}
                    aria-label={`选择 ${file.name}`}
                    checked={selected.includes(file.id)}
                    onChange={() => toggleSelected(file.id)}
                  />
                )}
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
                <FullVersion>
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
                </FullVersion>
                <span className={styles.date}>
                  {new Date(file.updated).toLocaleDateString("zh-CN", {
                    month: "2-digit",
                    day: "2-digit",
                  })}
                  <small>今天</small>
                </span>
                <span className={styles.owner}>
                  <span className={styles.ownerAvatar}>
                    {Array.from(creator(file.owner))[0]?.toUpperCase()}
                  </span>
                  {creator(file.owner)}
                </span>
                <div className={styles.rowActions}>
                  {!trash && file.kind !== "folder" && (
                    <FullVersion feature="分享">
                      <button
                        className="icon-button"
                        aria-label={`分享 ${file.name}`}
                        onClick={() => setAction({ type: "share", file })}
                      >
                        <Share2 size={15} />
                      </button>
                    </FullVersion>
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
      {transferAction && (
        <FileTransferDialog
          action={transferAction}
          close={() => setTransferAction(null)}
          onImported={loadFiles}
        />
      )}
      {contextMenu.menu}
      <FileDialogs
        action={action}
        close={() => setAction(null)}
        onCreated={(id, kind) => {
          if (kind === "doc") {
            navigate(`/document/${id}`);
            return;
          }
          if (
            action?.type === "upload" ||
            (action?.type === "create" &&
              (action.kind === "slide" ||
                action.kind === "sheet" ||
                ["pdf", "video", "image"].includes(action.kind)))
          )
            navigate(`/preview/${id}`);
        }}
      />
      {demoImportOpen && (
        <Suspense fallback={<p role="status">正在读取演示导入工具…</p>}>
          <DemoImport close={() => setDemoImportOpen(false)} />
        </Suspense>
      )}
    </main>
  );
}
