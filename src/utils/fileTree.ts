import type { Entry } from "@/store/workspace";

export const canContain = (parent: Entry, child: Pick<Entry, "kind">) =>
  parent.kind === "folder" || (parent.kind === "doc" && child.kind === "doc");

export function canMove(files: Entry[], id: string, parentId: string | null) {
  const file = files.find((f) => f.id === id && !f.deleted);
  if (!file) return false;
  if (parentId === null) return true;
  const parent = files.find((f) => f.id === parentId && !f.deleted);
  if (!parent || parent.space !== file.space || !canContain(parent, file))
    return false;
  const visited = new Set<string>();
  let cursor: Entry | undefined = parent;
  while (cursor) {
    if (cursor.id === id || visited.has(cursor.id)) return false;
    visited.add(cursor.id);
    cursor = files.find((f) => f.id === cursor!.parent);
  }
  return true;
}

export function siblings(files: Entry[], space: string, parent: string | null) {
  return files
    .filter((f) => f.space === space && !f.deleted && f.parent === parent)
    .sort(
      (a, b) => (a.order ?? files.indexOf(a)) - (b.order ?? files.indexOf(b)),
    );
}

export function entryPath(files: Entry[], entry: Entry) {
  const names = [entry.name];
  const visited = new Set([entry.id]);
  let parent = files.find((f) => f.id === entry.parent);
  while (parent && !visited.has(parent.id)) {
    names.unshift(parent.name);
    visited.add(parent.id);
    parent = files.find((f) => f.id === parent!.parent);
  }
  return names.join(" / ");
}

/** rc-tree treats the gap below an expanded node as an inside drop. */
export function treeDropDestination(
  files: Entry[], moving: Entry, target: Entry,
  position: number, dropToGap: boolean, expanded: boolean,
) {
  const firstChild = expanded && (!dropToGap || position === 1);
  const parent = !dropToGap || firstChild ? target.id : target.parent;
  const list = siblings(files, moving.space, parent).filter(f => f.id !== moving.id);
  const index = firstChild ? 0 : dropToGap
    ? list.findIndex(f => f.id === target.id) + (position > 0 ? 1 : 0)
    : list.length;
  return { parent, index };
}
