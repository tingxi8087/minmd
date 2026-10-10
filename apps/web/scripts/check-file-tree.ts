import assert from "node:assert/strict";
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});
Object.defineProperty(globalThis, "window", {
  value: { localStorage: globalThis.localStorage },
});
const { useWorkspace } = await import("../src/store/workspace");
const { siblings, canMove, treeDropDestination } = await import("../src/utils/fileTree");
const get = useWorkspace.getState;
const folder = get().add("层级验收", "folder", null);
const nested = get().add("二级目录", "folder", folder);
const parent = get().add("父文档", "doc", nested);
const child = get().add("子文档", "doc", parent);
assert.equal(canMove(get().files, folder, nested), false);
assert.equal(get().relocate(parent, child), false);
assert.equal(get().relocate("sheet-budget", parent), false);
assert.equal(get().relocate("personal-note", folder), false);
assert.equal(get().relocate(child, folder, 0), true);
assert.equal(siblings(get().files, "team", folder)[0].id, child);
assert.equal(get().relocate(child, parent), true);
const persisted = JSON.parse(storage.get("minmd-static-demo-v1")!).state.files;
assert.equal(
  persisted.find((f: { id: string }) => f.id === child).parent,
  parent,
);
console.log("文件树验收通过：嵌套、排序、父子文档、持久化与非法移动保护");

const target = get().files.find(f => f.id === nested)!;
const moving = get().files.find(f => f.id === child)!;
for (const gap of [false, true]) {
  const dest = treeDropDestination(get().files, moving, target, gap ? 1 : 0, gap, true);
  assert.deepEqual(dest, { parent: nested, index: 0 });
  assert.equal(get().relocate(child, dest.parent, dest.index), true);
  assert.equal(siblings(get().files, "team", nested)[0].id, child);
}
const after = treeDropDestination(get().files, moving, target, 1, true, false);
assert.equal(after.parent, folder);
console.log("拖拽验收通过：展开目录下首项、同层间隙与循环移动保护");
