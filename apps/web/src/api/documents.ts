import type { JSONContent } from "@tiptap/core";
import { request } from "@/http";
export type DocumentContent = {
  fileId: string;
  projection: JSONContent;
  revision: number;
  epoch: number;
  schemaVersion: number;
  savedAt: string;
};
export type DocumentTicket = {
  ticket: string;
  documentName: string;
  epoch: number;
  revision: number;
  schemaVersion: 1;
  protocolVersion: 1;
  maxSessions: number;
  expiresAt: string;
  url: string;
};
export type DocumentVersion = {
  id: string;
  revision: number;
  epoch: number;
  source: string;
  note: string;
  createdAt: string;
  actorId: string | null;
};
export const documentApi = {
  ticket: async (id: string) =>
    (
      await request.post<DocumentTicket>(
        `/app/files/${id}/collaboration-ticket`,
        { schemaVersion: 1 },
      )
    ).data,
  content: async (id: string, signal?: AbortSignal) =>
    (await request.get<DocumentContent>(`/app/files/${id}/content`, { signal }))
      .data,
  checkpoint: async (id: string, snapshot: number[], note?: string) =>
    (
      await request.post<{
        fileId: string;
        revision: number;
        epoch: number;
        savedAt: string;
        versionId?: string;
      }>(`/app/files/${id}/checkpoint`, {
        snapshot,
        manual: true,
        ...(note ? { note } : {}),
      })
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
      await request.get<{ version: DocumentVersion; projection: JSONContent }>(
        `/app/files/${id}/versions/${versionId}`,
      )
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
  import: async (
    id: string,
    projection: JSONContent,
    expectedRevision: number,
    expectedEpoch: number,
    signal?: AbortSignal,
  ) => {
    await request.post(
      `/app/files/${id}/content-import`,
      {
        projection,
        expectedRevision,
        expectedEpoch,
      },
      { signal },
    );
  },
};
