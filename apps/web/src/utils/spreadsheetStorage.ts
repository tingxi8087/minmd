import type { IWorkbookData } from "@univerjs/presets";
const database = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("minmd-spreadsheets", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("workbooks");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("workbooks", mode),
        request = operation(tx.objectStore("workbooks"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("表格保存失败"));
    });
  } finally {
    db.close();
  }
}
export const saveSpreadsheet = (id: string, data: IWorkbookData) =>
  transaction("readwrite", (store) => store.put(data, id));
export const getSpreadsheet = (id: string) =>
  transaction<IWorkbookData | undefined>("readonly", (store) => store.get(id));
export const deleteSpreadsheet = (id: string) =>
  transaction("readwrite", (store) => store.delete(id));
