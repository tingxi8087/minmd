import { filesApi } from "@/api/files";
import type { Entry } from "@/store/workspace";
import type { ScopedTask } from "@/utils/useScopedTask";

/** 删除父项已覆盖全部后代，避免再次请求已进入回收站的子项。 */
export function selectionRoots(files: Entry[], ids: string[]) {
  const selected = new Set(ids);
  const byId = new Map(files.map((file) => [file.id, file]));
  return files.filter((file) => {
    if (!selected.has(file.id)) return false;
    const visited = new Set([file.id]);
    let parent = file.parent;
    while (parent && !visited.has(parent)) {
      if (selected.has(parent)) return false;
      visited.add(parent);
      parent = byId.get(parent)?.parent ?? null;
    }
    return true;
  });
}

export async function deleteSelection(
  files: Entry[],
  ids: string[],
  task: ScopedTask,
) {
  const roots = selectionRoots(files, ids);
  if (roots.some((file) => file.permission && file.permission !== "manage"))
    throw new Error("部分文件没有管理权限，请调整选择后重试");
  const failed: string[] = [];
  for (const file of roots) {
    try {
      await task.wait(() => filesApi.remove(file.space, file.id, task.signal));
    } catch (error) {
      if (task.signal.aborted) throw error;
      failed.push(file.id);
    }
  }
  return { failed, deleted: roots.length - failed.length };
}
