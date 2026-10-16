import { useEffect, useRef, useState } from "react";
import { App, Dropdown, Tree, type TreeProps } from "antd";
import type { DataNode } from "antd/es/tree";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ChevronRight,
  PencilLine,
  FolderInput,
  Star,
  Share2,
  Trash2,
  Plus,
  MoreHorizontal,
  FileText,
  FolderClosed,
  Table2,
  Presentation,
  Upload,
  Download,
  Copy,
  FileType2,
  Video,
  Image,
} from "lucide-react";
import {
  type Entry,
  type FileKind,
  kindNames,
  useWorkspace,
} from "@/store/workspace";
import {
  canContain,
  canMove,
  siblings,
  treeDropDestination,
} from "@/utils/fileTree";
import FileDialogs, { type FileAction } from "@/components/FileDialogs";
import { useContextMenu, type ContextItem } from "@/components/ContextMenu";
import FileTransferDialog, {
  type TransferAction,
} from "@/components/FileTransferDialog";
import { isDemo } from "@/runtime";
import TooltipButton from "@/components/TooltipButton";
import { errorMessage } from "@/http";
import styles from "./index.module.less";

const icons = {
  doc: FileText,
  folder: FolderClosed,
  sheet: Table2,
  slide: Presentation,
  pdf: FileType2,
  video: Video,
  image: Image,
};
export default function WorkspaceTree() {
  const { files, space, relocate, patch } = useWorkspace();
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const contextMenu = useContextMenu();
  const location = useLocation();
  const [expanded, setExpanded] = useState<React.Key[]>([]);
  const draggedId = useRef<string | null>(null);
  const [folderDropTarget, setFolderDropTarget] = useState<string | null>(null);
  useEffect(() => {
    setExpanded([]);
    draggedId.current = null;
    setFolderDropTarget(null);
  }, [space]);
  const [action, setAction] = useState<FileAction | null>(null);
  const [transferAction, setTransferAction] = useState<TransferAction | null>(
    null,
  );
  const selected =
    location.pathname.match(/\/(?:document|preview)\/([^/]+)/)?.[1] ||
    new URLSearchParams(location.search).get("folder");
  useEffect(() => {
    const ancestors: string[] = [];
    let parent = files.find((f) => f.id === selected)?.parent;
    while (parent && !ancestors.includes(parent)) {
      ancestors.push(parent);
      parent = files.find((f) => f.id === parent)?.parent;
    }
    setExpanded((keys) => [...new Set([...keys, ...ancestors])]);
  }, [selected, files]);
  const createItems = (parent: Entry | null) => {
    const items: { key: string; label: string; icon: React.ReactNode }[] = (
      ["doc", "sheet", "folder"] as FileKind[]
    )
      .filter((kind) => !parent || canContain(parent, { kind }))
      .map((kind) => {
        const Icon = icons[kind];
        return {
          key: kind,
          label: `新建${parent?.kind === "doc" ? "子" : ""}${kindNames[kind]}`,
          icon: (
            <span className={styles.menuIcon}>
              <Icon size={16} />
            </span>
          ),
        };
      });
    if (!parent || parent.kind === "folder")
      items.push({
        key: "upload",
        label: "上传文件",
        icon: (
          <span className={styles.menuIcon}>
            <Upload size={16} />
          </span>
        ),
      });
    return items;
  };
  const create = (kind: string, parent: Entry | null) =>
    setAction(
      kind === "upload"
        ? { type: "upload", parent: parent?.id ?? null }
        : {
            type: "create",
            kind: kind as FileKind,
            parent: parent?.id ?? null,
          },
    );
  const fileMenu = (f: Entry): ContextItem[] => [
    ...createItems(f).map((item) => ({
      ...item,
      run: () => create(item.key as FileKind, f),
    })),
    ...(canContain(f, { kind: "doc" })
      ? [{ key: "divider", type: "divider" as const }]
      : []),
    {
      key: "rename",
      disabled: f.permission === "read",
      label: "重命名",
      icon: <PencilLine size={15} />,
      run: () => setAction({ type: "rename", file: f }),
    },
    {
      key: "move",
      disabled: Boolean(f.permission && f.permission !== "manage"),
      label: "移动到…",
      icon: <FolderInput size={15} />,
      run: () => setAction({ type: "move", file: f }),
    },
    {
      key: "copy",
      disabled: isDemo,
      label: isDemo ? "创建副本（部署后可使用）" : "创建副本",
      icon: <Copy size={15} />,
      run: () => {
        if (!isDemo)
          setAction({ type: "batch-copy", files: [f], parent: f.parent });
      },
    },
    ...(f.kind !== "folder"
      ? [
          {
            key: "favorite",
            label: f.favorite ? "取消收藏" : "添加收藏",
            icon: <Star size={15} />,
            run: () => {
              void patch(f.id, { favorite: !f.favorite }).catch(
                (error: unknown) => message.error(errorMessage(error)),
              );
            },
          },
          {
            key: "share",
            label: "分享设置",
            icon: <Share2 size={15} />,
            run: () => setAction({ type: "share", file: f }),
          },
        ]
      : []),
    {
      key: "export",
      label: isDemo ? "导出（部署后可使用）" : "导出",
      disabled: isDemo,
      icon: <Download size={15} />,
      run: () => {
        if (isDemo) return;
        setTransferAction({
          type: "export",
          spaceId: space,
          ids: [f.id],
          name: f.name,
        });
      },
    },
    { key: "delete-divider", type: "divider" },
    {
      key: "delete",
      disabled: Boolean(f.permission && f.permission !== "manage"),
      label: "移入回收站",
      icon: <Trash2 size={15} />,
      danger: true,
      run: () => {
        modal.confirm({
          title: "移入回收站？",
          content: `${f.name}及其子文件可以在回收站恢复。`,
          okText: "移入回收站",
          cancelText: "取消",
          okButtonProps: { danger: true },
          onOk: async () => {
            try {
              await patch(f.id, { deleted: true });
              if (selected === f.id) navigate("/files");
            } catch (error) {
              message.error(errorMessage(error));
              throw error;
            }
          },
        });
      },
    },
  ];
  const move = (id: string, parent: string | null, index?: number) => {
    void relocate(id, parent, index)
      .then((moved) => {
        if (!moved) {
          message.warning("无法移动到该位置");
          return;
        }
        if (parent) setExpanded((keys) => [...new Set([...keys, parent])]);
      })
      .catch((error: unknown) => message.error(errorMessage(error)));
  };
  const isFolderBody = (
    event: React.DragEvent<HTMLDivElement>,
    file: Entry,
  ) => {
    if (file.kind !== "folder" || !draggedId.current) return false;
    const bounds = event.currentTarget.getBoundingClientRect();
    // 行主体用于移入，上下边缘仍交给 Tree 的同级排序判定。
    return (
      event.clientY >= bounds.top + 4 && event.clientY <= bounds.bottom - 4
    );
  };
  const onFolderDragOver = (
    event: React.DragEvent<HTMLDivElement>,
    f: Entry,
  ) => {
    if (!isFolderBody(event, f)) {
      setFolderDropTarget(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const allowed = canMove(files, draggedId.current!, f.id);
    event.dataTransfer.dropEffect = allowed ? "move" : "none";
    setFolderDropTarget(allowed ? f.id : null);
  };
  const build = (parent: string | null, path = new Set<string>()): DataNode[] =>
    siblings(files, space, parent)
      .filter((f) => !path.has(f.id))
      .map((f) => {
        const children = build(f.id, new Set([...path, f.id]));
        const Icon = icons[f.kind];
        return {
          key: f.id,
          title: (
            <div
              className={`${styles.node} ${folderDropTarget === f.id ? styles.folderDropTarget : ""}`}
              onDragEnter={(event) => onFolderDragOver(event, f)}
              onDragOver={(event) => onFolderDragOver(event, f)}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                )
                  setFolderDropTarget(null);
              }}
              onDrop={(event) => {
                if (!isFolderBody(event, f)) return;
                event.preventDefault();
                event.stopPropagation();
                const id = draggedId.current!;
                draggedId.current = null;
                setFolderDropTarget(null);
                if (canMove(files, id, f.id)) move(id, f.id);
              }}
            >
              <Icon size={15} className={styles.fileIcon} data-kind={f.kind} />
              <span className={styles.name}>{f.name}</span>
              <button
                className={styles.more}
                aria-label={`更多操作 ${f.name}`}
                onClick={(e) =>
                  contextMenu.openButton(e, fileMenu(f), "文件操作")
                }
                onMouseDown={(e) => e.stopPropagation()}
              >
                <MoreHorizontal size={14} />
              </button>
            </div>
          ),
          children,
          isLeaf: children.length === 0,
        };
      });
  const onDrop: TreeProps["onDrop"] = ({
    node,
    dragNode,
    dropPosition,
    dropToGap,
  }) => {
    const moving = files.find((f) => f.id === dragNode.key)!;
    const target = files.find((f) => f.id === node.key)!;
    const position = dropPosition - Number(node.pos.split("-").at(-1));
    const { parent, index } = treeDropDestination(
      files,
      moving,
      target,
      position,
      dropToGap,
      Boolean(node.expanded && node.children?.length),
    );
    draggedId.current = null;
    setFolderDropTarget(null);
    move(moving.id, parent, index);
  };
  return (
    <section className={styles.treeSection}>
      <div className={styles.heading}>
        <span>空间文件</span>
        <Dropdown
          trigger={["click"]}
          menu={{
            items: createItems(null),
            onClick: ({ key }) => create(key as FileKind, null),
          }}
        >
          <TooltipButton className="icon-button" aria-label="新建文件或文件夹">
            <Plus size={15} />
          </TooltipButton>
        </Dropdown>
      </div>
      <Tree
        onRightClick={({ event, node }) => {
          const f = files.find((f) => f.id === node.key);
          if (f) contextMenu.open(event, fileMenu(f), "文件操作");
        }}
        blockNode
        onDragStart={({ node }) => {
          draggedId.current = String(node.key);
        }}
        onDragEnd={() => {
          draggedId.current = null;
          setFolderDropTarget(null);
        }}
        draggable={{
          icon: false,
          nodeDraggable: (node) => {
            const file = files.find((file) => file.id === node.key);
            return Boolean(
              file && (!file.permission || file.permission === "manage"),
            );
          },
        }}
        treeData={build(null)}
        expandedKeys={expanded}
        onExpand={setExpanded}
        selectedKeys={selected ? [selected] : []}
        switcherIcon={<ChevronRight size={13} />}
        allowDrop={({ dragNode, dropNode, dropPosition }) => {
          const target = files.find((f) => f.id === dropNode.key)!;
          return canMove(
            files,
            String(dragNode.key),
            dropPosition === 0 ? target.id : target.parent,
          );
        }}
        onDrop={onDrop}
        onSelect={(keys) => {
          const file = files.find((f) => f.id === keys[0]);
          if (!file) return;
          navigate(
            file.kind === "folder"
              ? `/files?folder=${file.id}`
              : `/${file.kind === "doc" ? "document" : "preview"}/${file.id}`,
          );
        }}
      />
      {!files.some((f) => f.space === space && !f.deleted) && (
        <span className={styles.empty}>暂无文件</span>
      )}
      {transferAction && (
        <FileTransferDialog
          action={transferAction}
          close={() => setTransferAction(null)}
        />
      )}
      {contextMenu.menu}
      <FileDialogs
        action={action}
        close={() => setAction(null)}
        onCreated={(id, kind) => {
          if (action?.type !== "create" && action?.type !== "upload") return;
          if (action.parent)
            setExpanded((keys) => [...new Set([...keys, action.parent!])]);
          navigate(
            action.type === "create" && action.kind === "folder"
              ? `/files?folder=${id}`
              : `/${kind === "doc" || (action.type === "create" && action.kind === "doc") ? "document" : "preview"}/${id}`,
          );
        }}
      />
    </section>
  );
}
