import type { Op, Sheet } from "@fortune-sheet/core";
import {
  getSpreadsheet,
  saveSpreadsheet,
  deleteSpreadsheet,
} from "@/utils/spreadsheetStorage";
export type Operation =
  | {
      type: "operations";
      operationId: string;
      baseRevision: number;
      epoch: number;
      operations: Op[];
    }
  | {
      type: "undo" | "redo";
      operationId: string;
      epoch: number;
      baseRevision: number;
    };
export type SheetDraft = {
  epoch: number;
  pending: Operation[];
  recovery: boolean;
};
export type RecoveryCopy = { key: string; draft: SheetDraft };
type Store = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;
export function recoveryPrefix(
  userId: string,
  spaceId: string,
  fileId: string,
  sessionId: string,
) {
  return `minmd-sheet-recovery-v2:${userId}:${spaceId}:${fileId}:${sessionId}:`;
}
export function readSheetDraft(
  key: string,
  store: Store = localStorage,
): SheetDraft | undefined {
  try {
    const value: unknown = JSON.parse(store.getItem(key) ?? "null");
    if (
      !value ||
      typeof value !== "object" ||
      !("pending" in value) ||
      !Array.isArray(value.pending) ||
      !("epoch" in value) ||
      !Number.isInteger(value.epoch) ||
      !("recovery" in value) ||
      typeof value.recovery !== "boolean"
    )
      return;
    return value as SheetDraft;
  } catch {
    return;
  }
}
export function listRecoveryCopies(
  prefix: string,
  legacyKey: string,
  store: Store = localStorage,
): RecoveryCopy[] {
  const keys = new Set([legacyKey]);
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(prefix)) keys.add(key);
  }
  return [...keys]
    .flatMap((key) => {
      const draft = readSheetDraft(key, store);
      return draft && (draft.pending.length || draft.recovery)
        ? [{ key, draft }]
        : [];
    })
    .sort((a, b) => b.draft.epoch - a.draft.epoch);
}
/** 版本切换只冻结已有副本元数据，绝不拿新服务器工作簿覆盖原快照。 */
export function markRecovery(key: string, store: Store = localStorage) {
  const value = readSheetDraft(key, store);
  if (value) store.setItem(key, JSON.stringify({ ...value, recovery: true }));
}
const writes = new Map<string, Promise<unknown>>();
export function saveRecoveryWorkbook(
  key: string,
  sheets: Sheet[],
  write = saveSpreadsheet,
) {
  const snapshot = structuredClone(sheets);
  const next = (writes.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => write(key, snapshot));
  writes.set(key, next);
  void next
    .finally(() => {
      if (writes.get(key) === next) writes.delete(key);
    })
    .catch(() => {});
  return next;
}
export function discardRecoveryWorkbook(
  key: string,
  remove = deleteSpreadsheet,
) {
  const next = (writes.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => remove(key));
  writes.set(key, next);
  void next
    .finally(() => {
      if (writes.get(key) === next) writes.delete(key);
    })
    .catch(() => {});
  return next;
}
export async function readRecoveryWorkbook(key: string, read = getSpreadsheet) {
  await writes.get(key);
  return read(key);
}

export function shouldWarnSheetLeave(
  hasIdentity: boolean,
  pendingCount: number,
  nextPath: string,
): boolean {
  return (
    hasIdentity &&
    pendingCount > 0 &&
    nextPath !== "/login" &&
    !nextPath.startsWith("/login/")
  );
}
