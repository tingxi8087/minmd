import { request } from "@/http";
export type TransferStatus = {
  id: string;
  operation: "import" | "export";
  status: "waiting-upload" | "processing" | "ready" | "completed" | "failed";
  done: number;
  total: number;
  expiresAt: string;
  filename: string | null;
  mode: "complete" | "markdown" | null;
  fileCount: number;
  assetCount: number;
  fileIds: string[];
  error: { code: string; message: string } | null;
};
export type ImportTarget = {
  parentId: string | null;
  replaceFileId: string | null;
  expectedRevision?: number;
  expectedEpoch?: number;
};
export const fileTransfersApi = {
  export: async (
    spaceId: string,
    ids: string[],
    mode: "complete" | "markdown",
    single: boolean,
    signal?: AbortSignal,
  ) =>
    (
      await request.post<TransferStatus>(
        `/app/spaces/${spaceId}/file-exports`,
        { ids, mode, single },
        { signal },
      )
    ).data,
  import: async (
    spaceId: string,
    batchId: string,
    target: ImportTarget,
    signal?: AbortSignal,
  ) =>
    (
      await request.post<TransferStatus>(
        `/app/spaces/${spaceId}/file-imports`,
        { batchId, ...target },
        { signal },
      )
    ).data,
  status: async (id: string, signal?: AbortSignal) =>
    (await request.get<TransferStatus>(`/app/file-transfers/${id}`, { signal }))
      .data,
  upload: async (
    id: string,
    file: File,
    signal?: AbortSignal,
    onProgress?: (percent: number) => void,
  ) =>
    (
      await request.put<TransferStatus>(
        `/app/file-transfers/${id}/package`,
        file,
        {
          signal,
          timeout: 0,
          headers: { "Content-Type": "application/zip" },
          onUploadProgress: (event) => {
            if (event.total)
              onProgress?.(Math.floor((event.loaded / event.total) * 100));
          },
        },
      )
    ).data,
  commit: async (id: string, signal?: AbortSignal) =>
    (
      await request.post<TransferStatus>(
        `/app/file-transfers/${id}/commit`,
        {},
        { signal },
      )
    ).data,
  cancel: async (id: string, signal?: AbortSignal) =>
    (await request.delete(`/app/file-transfers/${id}`, { signal })).data,
  download: async (id: string, signal?: AbortSignal) =>
    (
      await request.get<Blob>(`/app/file-transfers/${id}/download`, {
        signal,
        responseType: "blob",
        timeout: 0,
      })
    ).data,
};
