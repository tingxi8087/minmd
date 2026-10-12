import type { JSONContent } from "@tiptap/core";
export type RecoveryDraft = {
  userId: string;
  spaceId: string;
  fileId: string;
  sessionId: string;
  epoch: number;
  projection: JSONContent;
  updatedAt: string;
};
export const draftKey = (
  draft: Pick<
    RecoveryDraft,
    "userId" | "spaceId" | "fileId" | "sessionId" | "epoch"
  >,
) => {
  const base = `${draft.userId}/${draft.spaceId}/${draft.fileId}/${draft.epoch}`;
  return draft.sessionId ? `${base}/${draft.sessionId}` : base;
};

async function operation<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("minmd-document-recovery", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("drafts");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("drafts", mode),
        request = callback(tx.objectStore("drafts"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
const writes = new Map<string, Promise<unknown>>();
function queued<T>(id: string, write: () => Promise<T>): Promise<T> {
  const next = (writes.get(id) ?? Promise.resolve())
    .catch(() => {})
    .then(write);
  writes.set(id, next);
  void next
    .finally(() => {
      if (writes.get(id) === next) writes.delete(id);
    })
    .catch(() => {});
  return next;
}
export const saveDraft = (draft: RecoveryDraft) =>
  queued(draftKey(draft), () =>
    operation("readwrite", (store) => store.put(draft, draftKey(draft))),
  );
export const removeDraft = (
  draft: Pick<
    RecoveryDraft,
    "userId" | "spaceId" | "fileId" | "sessionId" | "epoch"
  >,
) =>
  queued(draftKey(draft), () =>
    operation("readwrite", (store) => store.delete(draftKey(draft))),
  );
export function filterRecoveryDrafts(
  drafts: RecoveryDraft[],
  userId: string,
  spaceId: string,
  fileId: string,
) {
  return drafts
    .filter(
      (draft) =>
        draft.userId === userId &&
        draft.spaceId === spaceId &&
        draft.fileId === fileId,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export const readDrafts = async (
  userId: string,
  spaceId: string,
  fileId: string,
) =>
  filterRecoveryDrafts(
    await operation<RecoveryDraft[]>("readonly", (store) => store.getAll()),
    userId,
    spaceId,
    fileId,
  );
