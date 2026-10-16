import { useState } from "react";
import { Input, Tree } from "antd";
import type { DataNode } from "antd/es/tree";
import {
  Check,
  ChevronRight,
  FileText,
  Folder,
  Home,
  Search,
} from "lucide-react";
import FileIcon from "@/components/FileIcon";
import type { Entry } from "@/store/workspace";
import { canContain, canMove, entryPath, siblings } from "@/utils/fileTree";
import styles from "./index.module.less";
export default function DestinationPicker({
  file,
  files,
  value,
  onChange,
  spaceName,
  restore = false,
  disabled = false,
  selection,
  copy = false,
}: {
  file: Entry;
  files: Entry[];
  value: string | null;
  onChange: (value: string | null) => void;
  spaceName: string;
  restore?: boolean;
  disabled?: boolean;
  selection?: Entry[];
  copy?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<React.Key[]>(() => {
    const ids: string[] = [];
    let parent = file.parent;
    while (parent && !ids.includes(parent)) {
      ids.push(parent);
      parent = files.find((item) => item.id === parent)?.parent ?? null;
    }
    return ids;
  });
  const sources = selection ?? [file];
  const allowed = (id: string | null) =>
    sources.every((source) => canMove(files, source.id, id));
  const candidates = files.filter(
    (item) =>
      item.space === file.space &&
      !item.deleted &&
      sources.every((source) => canContain(item, source)),
  );
  const ids = new Set(candidates.map((item) => item.id));
  const sourceParent = files.find((item) => item.id === file.parent);
  const sourcePath = sourceParent
    ? `${spaceName} / ${entryPath(files, sourceParent)}`
    : spaceName;
  const selected = files.find((item) => item.id === value && !item.deleted);
  const selectedPath =
    value === null
      ? `${spaceName} / 空间根目录`
      : selected
        ? `${spaceName} / ${entryPath(files, selected)}`
        : "请选择有效的目标位置";
  const reason = (item: Entry) =>
    sources.some((source) => source.id === item.id)
      ? copy
        ? "不能复制到自身"
        : "不能移入自身"
      : !allowed(item.id)
        ? copy
          ? "不能复制到子目录"
          : "不能移入子目录"
        : item.id === file.parent
          ? "当前位置"
          : "";
  const title = (item: Entry) => (
    <div
      data-kind={item.kind}
      aria-disabled={!allowed(item.id)}
      className={`${styles.rowTitle} ${allowed(item.id) ? "" : styles.unavailable}`}
    >
      {item.kind === "folder" ? <Folder size={17} /> : <FileText size={17} />}
      <span className={styles.name} title={item.name}>
        {item.name}
      </span>
      {item.kind === "doc" && <small>文档</small>}
      {reason(item) && <small>{reason(item)}</small>}
      {value === item.id && <Check size={15} className={styles.check} />}
    </div>
  );
  const build = (
    parent: string | null,
    visited = new Set<string>(),
  ): DataNode[] =>
    siblings(candidates, file.space, parent)
      .filter((item) => !visited.has(item.id))
      .map((item) => ({
        key: item.id,
        title: title(item),
        selectable: !disabled && allowed(item.id),
        children: build(item.id, new Set([...visited, item.id])),
      }));
  const roots = candidates.filter(
    (item) => item.parent !== null && !ids.has(item.parent),
  );
  const tree = [
    ...build(null),
    ...roots.map((item) => ({
      key: item.id,
      title: title(item),
      selectable: !disabled && allowed(item.id),
      children: build(item.id, new Set([item.id])),
    })),
  ];
  const normalized = query.trim().toLocaleLowerCase();
  const results = candidates.filter((item) =>
    `${item.name} ${entryPath(files, item)}`
      .toLocaleLowerCase()
      .includes(normalized),
  );
  return (
    <div className={styles.picker}>
      <div className={styles.source}>
        <FileIcon kind={sources.length > 1 ? "folder" : file.kind} />
        <div>
          <strong title={file.name}>
            {sources.length > 1 ? `已选择 ${sources.length} 项` : file.name}
          </strong>
          <p title={sourcePath}>
            {sources.some((source) => source.parent !== file.parent)
              ? "来自多个位置"
              : `${restore ? "原位置" : "当前位置"}：${sourcePath}`}
          </p>
        </div>
        {sources.some(
          (source) =>
            source.kind === "folder" ||
            files.some((child) => child.parent === source.id),
        ) && <small>包含全部子文件</small>}
      </div>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        disabled={disabled}
        allowClear
        prefix={<Search size={16} />}
        placeholder={
          sources.every((source) => source.kind === "doc")
            ? "搜索文件夹或目标文档"
            : "搜索文件夹"
        }
        aria-label="搜索目标位置"
      />
      <div className={styles.browser}>
        <button
          type="button"
          className={`${styles.root} ${value === null ? styles.selected : ""}`}
          disabled={disabled || !allowed(null)}
          onClick={() => onChange(null)}
          aria-pressed={value === null}
        >
          <Home size={17} />
          <span>空间根目录</span>
          {file.parent === null && <small>当前位置</small>}
          {value === null && <Check size={15} />}
        </button>
        <div className={styles.scroll}>
          {normalized ? (
            results.length ? (
              <div className={styles.results}>
                {results.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    disabled={disabled || !allowed(item.id)}
                    className={value === item.id ? styles.selected : ""}
                    aria-label={`选择目标 ${entryPath(files, item)}`}
                    aria-pressed={value === item.id}
                    onClick={() => onChange(item.id)}
                  >
                    {title(item)}
                    <span className={styles.path}>
                      {entryPath(files, item)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className={styles.empty} role="status">
                没有找到匹配的位置
              </p>
            )
          ) : tree.length ? (
            <Tree
              blockNode
              autoExpandParent={false}
              defaultExpandParent={false}
              treeData={tree}
              expandedKeys={expanded}
              onExpand={setExpanded}
              selectedKeys={value ? [value] : []}
              switcherIcon={<ChevronRight size={14} />}
              onSelect={(keys) => {
                const id = keys[0];
                if (id && !disabled && allowed(String(id)))
                  onChange(String(id));
              }}
            />
          ) : (
            <p className={styles.empty}>暂无可选目录，可选择空间根目录。</p>
          )}
        </div>
      </div>
      <div className={styles.destination}>
        <span>{restore ? "恢复到" : copy ? "复制到" : "移动到"}</span>
        <strong title={selectedPath}>{selectedPath}</strong>
      </div>
    </div>
  );
}
