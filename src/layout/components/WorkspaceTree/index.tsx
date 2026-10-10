import { useEffect, useState } from "react";
import { App, Dropdown, Tree, type TreeProps } from "antd";
import type { DataNode } from "antd/es/tree";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ChevronRight,
  Plus,
  MoreHorizontal,
  FileText,
  FolderClosed,
  Table2,
  Presentation,
} from "lucide-react";
import { Entry, FileKind, kindNames, useWorkspace } from "@/store/workspace";
import { canContain, canMove, siblings, treeDropDestination } from "@/utils/fileTree";
import FileDialogs, { FileAction } from "@/components/FileDialogs";
import TooltipButton from "@/components/TooltipButton";
import styles from "./index.module.less";

const icons = {
  doc: FileText,
  folder: FolderClosed,
  sheet: Table2,
  slide: Presentation,
};
export default function WorkspaceTree() {
  const { files, space, relocate } = useWorkspace();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [expanded, setExpanded] = useState<React.Key[]>([]);
  const [action, setAction] = useState<FileAction | null>(null);
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
  const createItems = (parent: Entry | null) =>
    (["doc", "sheet", "slide", "folder"] as FileKind[])
      .filter((kind) => !parent || canContain(parent, { kind }))
      .map((kind) => ({
        key: kind,
        label: `新建${parent?.kind === "doc" ? "子" : ""}${kindNames[kind]}`,
        icon: (
          <span className={styles.menuIcon}>
            {(() => {
              const Icon = icons[kind];
              return <Icon size={16} />;
            })()}
          </span>
        ),
      }));
  const create = (kind: FileKind, parent: Entry | null) =>
    setAction({ type: "create", kind, parent: parent?.id ?? null });
  const build = (parent: string | null, path = new Set<string>()): DataNode[] =>
    siblings(files, space, parent)
      .filter((f) => !path.has(f.id))
      .map((f) => {
        const children = build(f.id, new Set([...path, f.id]));
        const Icon = icons[f.kind];
        return {
          key: f.id,
          title: (
            <div className={styles.node}>
              <Icon size={15} className={styles.fileIcon} data-kind={f.kind} />
              <span className={styles.name}>{f.name}</span>
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    ...createItems(f),
                    ...(canContain(f, { kind: "doc" })
                      ? [{ type: "divider" as const }]
                      : []),
                    { key: "rename", label: "重命名" },
                    { key: "move", label: "移动到…" },
                  ],
                  onClick: ({ key, domEvent }) => {
                    domEvent.stopPropagation();
                    if (key === "rename" || key === "move")
                      setAction({ type: key, file: f });
                    else create(key as FileKind, f);
                  },
                }}
              >
                <button
                  className={styles.more}
                  aria-label={`更多操作 ${f.name}`}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal size={14} />
                </button>
              </Dropdown>
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
      files, moving, target, position, dropToGap, Boolean(node.expanded && node.children?.length),
    );
    if (!relocate(moving.id, parent, index))
      return message.warning("无法移动到该位置");
    if (parent) setExpanded((keys) => [...new Set([...keys, parent])]);
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
        blockNode
        draggable={{ icon: false }}
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
      <FileDialogs
        action={action}
        close={() => setAction(null)}
        onCreated={(id) => {
          if (action?.type !== "create") return;
          if (action.parent)
            setExpanded((keys) => [...new Set([...keys, action.parent!])]);
          navigate(
            action.kind === "folder"
              ? `/files?folder=${id}`
              : `/${action.kind === "doc" ? "document" : "preview"}/${id}`,
          );
        }}
      />
    </section>
  );
}
