import type { Sheet } from "@fortune-sheet/core";
import { request } from "@/http";
import type { DocumentTicket, DocumentVersion } from "./documents";
export type SheetContent = {
  fileId: string;
  projection: { sheets: Sheet[] };
  revision: number;
  epoch: number;
  schemaVersion: number;
  savedAt: string;
};
export type SheetCheckpoint = {
  fileId: string;
  revision: number;
  epoch: number;
  savedAt: string;
  versionId?: string;
};
export const sheetApi = {
  content: async (id: string, signal?: AbortSignal) =>
    (await request.get<SheetContent>(`/app/files/${id}/content`, { signal }))
      .data,
  ticket: async (id: string, editSessionId: string) =>
    (
      await request.post<DocumentTicket & { editSessionId: string }>(
        `/app/files/${id}/collaboration-ticket`,
        { schemaVersion: 1, editSessionId },
      )
    ).data,
  checkpoint: async (id: string, revision: number, epoch: number) =>
    (
      await request.post<SheetCheckpoint>(`/app/files/${id}/checkpoint`, {
        manual: true,
        revision,
        epoch,
      })
    ).data,
  import: async (
    id: string,
    sheets: Sheet[],
    expectedRevision: number,
    expectedEpoch: number,
    signal?: AbortSignal,
  ) =>
    (
      await request.post<SheetCheckpoint>(
        `/app/files/${id}/content-import`,
        {
          projection: { sheets },
          expectedRevision,
          expectedEpoch,
        },
        { signal },
      )
    ).data,
  versions: async (id: string, page = 1) =>
    (
      await request.get<{
        items: DocumentVersion[];
        total: number;
        page: number;
        pageSize: number;
      }>(`/app/files/${id}/versions`, { params: { page, pageSize: 30 } })
    ).data,
  version: async (id: string, versionId: string) =>
    (
      await request.get<{
        version: DocumentVersion;
        projection: { sheets: Sheet[] };
      }>(`/app/files/${id}/versions/${versionId}`)
    ).data,
  note: async (id: string, versionId: string, note: string) => {
    await request.patch(`/app/files/${id}/versions/${versionId}`, { note });
  },
  restore: async (
    id: string,
    versionId: string,
    expectedRevision: number,
    expectedEpoch: number,
  ) => {
    await request.post(`/app/files/${id}/versions/${versionId}/restore`, {
      expectedRevision,
      expectedEpoch,
    });
  },
};
