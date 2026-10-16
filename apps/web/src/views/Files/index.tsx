import FileTransferDialog, {
  type TransferAction,
} from "@/components/FileTransferDialog";
import { isDemo, FullVersion } from "@/runtime";
import { usePageTitle } from "@/components/PageTitles";
import axios from "axios";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { App, Checkbox, Dropdown, Select } from "antd";
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
  ListChecks,
  Share2,
  Star,
  Trash2,
  Undo2,
  Upload,
  Download,
  Copy,
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
import TooltipButton from "@/components/TooltipButton";
import { useScopedTasks } from "@/utils/useScopedTask";
import { deleteSelection } from "./selection";
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
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState<"list" | "grid">("list");
  const [action, setAction] = useState<FileAction | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const begin = useScopedTasks();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [transferAction, setTransferAction] = useState<TransferAction | null>(
    null,
  );
  const [sort, setSort] = useState<"updated" | "name">("updated");
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
    setDeleting(false);
    setTransferAction(null);
  }, [space, parent, pathname, user]);
  const isHome = pathname === "/files" && !folder;
  const trash = pathname === "/trash";
  useEffect(() => {
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
    .filter((f) => filter === "all" || f.kind === filter)
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
    !deleting &&
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
  useEffect(() => {
    setSelectedIds([]);
  }, [filter]);
  const removeSelected = () => {
    if (!selected.length || deleting || isDemo) return;
    const task = begin();
    const ids = [...selected];
    const snapshot = [...files];
    const confirmation = modal.confirm({
      keyboard: false,
      title: `将选中的 ${ids.length} 项移入回收站？`,
      content: "文件夹及其子文件一并移入回收站，之后可以恢复。",
      okText: "移入回收站",
      okButtonProps: { danger: true },
      cancelText: "取消",
      afterClose: () => task.finish(),
      onOk: async () => {
        try {
          task.assertActive();
          setDeleting(true);
          confirmation.update({ cancelButtonProps: { disabled: true } });
          const result = await deleteSelection(snapshot, ids, task);
          await task.wait(() => loadFiles());
          setSelectedIds(result.failed);
          if (result.failed.length)
            message.warning("部分文件未能移入回收站，已保留失败项供重试");
          else {
            message.success("已移入回收站");
            setSelecting(false);
          }
        } catch (error) {
          if (!task.signal.aborted) message.error(errorMessage(error));
        } finally {
          if (!task.signal.aborted) setDeleting(false);
          task.finish();
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
          {
            key: "copy",
            disabled: isDemo,
            label: isDemo ? "创建副本（部署后可使用）" : "创建副本",
            icon: <Copy size={15} />,
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
            key: "export",
            label: isDemo ? "导出（部署后可使用）" : "导出",
            disabled: isDemo,
            icon: <Download size={15} />,
          },
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
      else if (key === "export") {
        if (isDemo) return;
        setTransferAction({
          type: "export",
          spaceId: space,
          ids: [file.id],
          name: file.name,
        });
      } else if (key === "copy") {
        if (!isDemo)
          setAction({ type: "batch-copy", files: [file], parent: file.parent });
      } else if (key === "favorite")
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
    icon: (
      <span className={styles.menuIcon}>
        <Upload size={17} strokeWidth={1.7} />
      </span>
    ),
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
            <>
              <button
                className="secondary-button"
                onClick={() => setAction({ type: "upload", parent })}
              >
                <Upload size={15} />
                上传文件
              </button>

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
      <section className={styles.fileSection}>
        <div className={styles.sectionHeader}>
          {selecting ? (
            <div className={styles.selectionSummary}>
              <Checkbox
                aria-label="全选当前列表"
                checked={
                  visible.length > 0 && selected.length === visible.length
                }
                indeterminate={
                  selected.length > 0 && selected.length < visible.length
                }
                disabled={deleting || !visible.length}
                onChange={(event) =>
                  setSelectedIds(
                    event.target.checked ? visible.map((file) => file.id) : [],
                  )
                }
              >
                全选
              </Checkbox>
              <span role="status">已选 {selected.length} 项</span>
            </div>
          ) : (
            <div className={styles.listTitle}>
              <h2>{isHome ? "空间里的文件" : "全部文件"}</h2>
              <span>{visible.length}</span>
            </div>
          )}
          <div className={styles.listActions}>
            {selecting && (
              <div className={styles.bulkActions}>
                <span className={styles.desktopBulk}>
                  <TooltipButton
                    className="icon-button"
                    aria-label="移动选中"
                    disabled={
                      !selected.length ||
                      deleting ||
                      visible.some(
                        (file) =>
                          selected.includes(file.id) &&
                          Boolean(
                            file.permission && file.permission !== "manage",
                          ),
                      )
                    }
                    onClick={() =>
                      setAction({
                        type: "batch-move",
                        files: visible.filter((file) =>
                          selected.includes(file.id),
                        ),
                        parent,
                      })
                    }
                  >
                    <FolderInput size={17} />
                  </TooltipButton>
                  <TooltipButton
                    className="icon-button"
                    aria-label="创建选中副本"
                    disabled={!selected.length || deleting}
                    onClick={() =>
                      setAction({
                        type: "batch-copy",
                        files: visible.filter((file) =>
                          selected.includes(file.id),
                        ),
                        parent,
                      })
                    }
                  >
                    <Copy size={17} />
                  </TooltipButton>
                </span>
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    items: [
                      {
                        key: "move",
                        label: "移动到…",
                        icon: <FolderInput size={15} />,
                        disabled:
                          !selected.length ||
                          deleting ||
                          visible.some(
                            (file) =>
                              selected.includes(file.id) &&
                              Boolean(
                                file.permission && file.permission !== "manage",
                              ),
                          ),
                      },
                      {
                        key: "copy",
                        label: "创建副本",
                        icon: <Copy size={15} />,
                        disabled: !selected.length || deleting,
                      },
                    ],
                    onClick: ({ key }) =>
                      setAction({
                        type: key === "move" ? "batch-move" : "batch-copy",
                        files: visible.filter((file) =>
                          selected.includes(file.id),
                        ),
                        parent,
                      }),
                  }}
                >
                  <TooltipButton
                    className={`icon-button ${styles.mobileBulk}`}
                    aria-label="更多批量操作"
                    disabled={deleting}
                  >
                    <MoreHorizontal size={17} />
                  </TooltipButton>
                </Dropdown>
                <TooltipButton
                  className="icon-button"
                  aria-label="导出选中"
                  disabled={!selected.length || deleting}
                  onClick={() =>
                    setTransferAction({
                      type: "export",
                      spaceId: space,
                      ids: selected,
                    })
                  }
                >
                  <Download size={17} />
                </TooltipButton>
                <TooltipButton
                  className={`icon-button ${styles.deleteAction}`}
                  aria-label="删除选中"
                  disabled={
                    !selected.length ||
                    deleting ||
                    visible.some(
                      (file) =>
                        selected.includes(file.id) &&
                        Boolean(
                          file.permission && file.permission !== "manage",
                        ),
                    )
                  }
                  onClick={removeSelected}
                >
                  <Trash2 size={17} />
                </TooltipButton>
              </div>
            )}
            {!trash && (
              <FullVersion feature="多选文件">
                <TooltipButton
                  className={`icon-button ${styles.selectionToggle}`}
                  aria-label={selecting ? "退出多选" : "多选文件"}
                  aria-pressed={selecting}
                  disabled={deleting}
                  onClick={() => {
                    setSelecting(!selecting);
                    setSelectedIds([]);
                  }}
                >
                  <ListChecks size={18} />
                </TooltipButton>
              </FullVersion>
            )}
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
                    disabled={deleting}
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
              {trash
                ? "回收站是空的"
                : filter !== "all"
                  ? "这个分类暂无文件"
                  : "这里还有很多可能"}
            </h3>
            <p>
              {trash
                ? "删除的文件会暂存在这里"
                : filter !== "all"
                  ? "试试其他文件类型，或上传一份文件"
                  : "新建一份文件，留下你的第一个想法"}
            </p>
            {!trash && (
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
        onCompleted={() => {
          setSelectedIds([]);
          setSelecting(false);
        }}
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
    </main>
  );
}
