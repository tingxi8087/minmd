import assert from "node:assert/strict";
import type { Sheet } from "@fortune-sheet/core";
import {
  listRecoveryCopies,
  markRecovery,
  recoveryPrefix,
  saveRecoveryWorkbook,
  readRecoveryWorkbook,
  discardRecoveryWorkbook,
  type SheetDraft,
} from "../src/views/Spreadsheet/recovery";
import {
  draftKey,
  filterRecoveryDrafts,
  type RecoveryDraft,
} from "../src/views/Document/drafts";
const values = new Map<string, string>();
const storage = {
  get length() {
    return values.size;
  },
  key: (index: number) => [...values.keys()][index] ?? null,
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
  removeItem: (key: string) => {
    values.delete(key);
  },
};
const prefix = recoveryPrefix("alice", "space", "file", "tab");
const oldKey = `${prefix}1:old`,
  freshKey = `${prefix}2:new`;
const oldDraft: SheetDraft = {
  epoch: 1,
  pending: [{ type: "undo", epoch: 1, baseRevision: 1, operationId: "old-op" }],
  recovery: false,
};
storage.setItem(oldKey, JSON.stringify(oldDraft));
const snapshots = new Map<string, Sheet[]>();
const sheet = (value: number): Sheet[] => [
  {
    id: "s",
    name: "工作表",
    order: 0,
    celldata: [{ r: 0, c: 0, v: { v: value } }],
  },
];
let unblock!: () => void;
const slow = new Promise<void>((resolve) => {
  unblock = resolve;
});
const write = async (key: string, workbook: Sheet[]) => {
  await slow;
  snapshots.set(key, workbook);
  return key;
};
const oldLocal = sheet(7);
const writing = saveRecoveryWorkbook(oldKey, oldLocal, write);
oldLocal[0].celldata![0].v = { v: 999 };
markRecovery(oldKey, storage);
assert.equal(
  listRecoveryCopies(prefix, "legacy", storage)[0].draft.recovery,
  true,
);
unblock();
await writing;
assert.deepEqual(
  snapshots.get(oldKey),
  sheet(7),
  "异步保存捕获修改时快照，不引用后来的服务器/界面数组",
);
await saveRecoveryWorkbook(freshKey, sheet(22), async (key, workbook) => {
  snapshots.set(key, workbook);
  return key;
});
storage.setItem(freshKey, JSON.stringify({ ...oldDraft, epoch: 2 }));
assert.deepEqual(
  await readRecoveryWorkbook(oldKey, async (key) => snapshots.get(key)),
  sheet(7),
  "新epoch输入不覆盖旧恢复副本",
);
assert.deepEqual(
  await readRecoveryWorkbook(freshKey, async (key) => snapshots.get(key)),
  sheet(22),
);
assert.equal(listRecoveryCopies(prefix, "legacy", storage).length, 2);
for (const other of [
  recoveryPrefix("bob", "space", "file", "tab"),
  recoveryPrefix("alice", "other", "file", "tab"),
  recoveryPrefix("alice", "space", "other", "tab"),
  recoveryPrefix("alice", "space", "file", "other"),
])
  assert.equal(listRecoveryCopies(other, "none", storage).length, 0);
storage.removeItem(freshKey);
await discardRecoveryWorkbook(freshKey, async (key) => {
  snapshots.delete(key);
});
assert(snapshots.has(oldKey), "确认新修改只清新缓存，旧epoch副本仍可下载");
assert.equal(listRecoveryCopies(prefix, "legacy", storage).length, 1);
const legacy = "minmd-sheet-editor:alice:file:old-draft";
storage.setItem(legacy, JSON.stringify({ ...oldDraft, recovery: true }));
snapshots.set(legacy, sheet(3));
assert(
  listRecoveryCopies(prefix, legacy, storage).some(
    (copy) => copy.key === legacy,
  ),
  "旧版本未迁移快照保持可下载",
);
const doc: RecoveryDraft = {
  userId: "alice",
  spaceId: "space",
  fileId: "file",
  sessionId: "tab",
  epoch: 1,
  projection: { type: "doc", content: [] },
  updatedAt: "2026-10-12T00:00:00Z",
};
const documents = [
  doc,
  { ...doc, epoch: 2, updatedAt: "2026-10-12T01:00:00Z" },
  { ...doc, userId: "bob" },
  { ...doc, spaceId: "other" },
  { ...doc, fileId: "other" },
];
const mine = filterRecoveryDrafts(documents, "alice", "space", "file");
assert.equal(mine.length, 2);
assert.equal(mine[0].epoch, 2);
assert.notEqual(draftKey(mine[0]), draftKey(mine[1]));
assert.equal(
  mine.filter((item) => draftKey(item) !== draftKey(mine[0])).length,
  1,
  "忽略一个epoch不隐藏同会话其他恢复草稿",
);
console.log(
  "恢复边界验证通过：账号/空间/文件/会话/epoch隔离、旧版副本、冻结不覆盖、异步快照捕获、ACK只清当前缓存",
);

const { shouldWarnSheetLeave } =
  await import("../src/views/Spreadsheet/recovery");
assert.equal(shouldWarnSheetLeave(true, 1, "/files"), true);
assert.equal(shouldWarnSheetLeave(true, 0, "/files"), false);
assert.equal(shouldWarnSheetLeave(false, 1, "/files"), false, "退出账号不拦截");
assert.equal(
  shouldWarnSheetLeave(true, 1, "/login"),
  false,
  "权限失效跳登录不拦截",
);
