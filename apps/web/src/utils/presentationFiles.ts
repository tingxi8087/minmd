import { assertUploadSize } from "@/utils/uploadLimits";
const database = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("minmd-files", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("presentations");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("presentations", mode);
      const request = operation(transaction.objectStore("presentations"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () =>
        reject(transaction.error || new Error("文件保存失败"));
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
export const savePresentation = (id: string, file: File) =>
  transact("readwrite", (store) => store.put(file, id));
export const getPresentation = (id: string) =>
  transact<File | undefined>("readonly", (store) => store.get(id));
export const deletePresentation = (id: string) =>
  transact("readwrite", (store) => store.delete(id));
export async function validatePresentation(file: File) {
  if (!/\.pptx$/i.test(file.name)) throw new Error("仅支持 .pptx 文件");
  assertUploadSize(file);
  const { parseZip, buildPresentation, RECOMMENDED_ZIP_LIMITS } =
    await import("@aiden0z/pptx-renderer");
  let model;
  try {
    model = buildPresentation(
      await parseZip(await file.arrayBuffer(), RECOMMENDED_ZIP_LIMITS),
    );
  } catch {
    throw new Error("无法读取此 PPTX，请检查文件是否损坏或受到加密保护");
  }
  if (!model.slides.length) throw new Error("文件中没有可预览的幻灯片");
  return model.slides.length;
}
