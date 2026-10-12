import type { JSONContent } from "@tiptap/core";
import type { Sheet } from "@fortune-sheet/core";
import { request } from "@/http";
import type { PresentationProjection } from "@/api/assets";
export type ShareStatus = {
  visibility: "public" | "private";
  enabled: boolean;
  hasPassword: boolean;
  expiresAt: string | null;
  generation: number;
  token?: string;
};
export type PublicShare = {
  file: { id: string; name: string; kind: "doc" | "sheet" | "slide" };
  content: {
    projection:
      JSONContent | Sheet[] | { sheets: Sheet[] } | PresentationProjection;
    revision: number;
    epoch: number;
    schemaVersion: number;
    savedAt: string;
  };
};
export const sharesApi = {
  get: async (fileId: string) =>
    (await request.get<ShareStatus>(`/app/files/${fileId}/share`)).data,
  save: async (
    fileId: string,
    values: {
      visibility: "public" | "private";
      password?: string | null;
      expiresAt?: string | null;
      rotate?: boolean;
    },
  ) =>
    (await request.put<ShareStatus>(`/app/files/${fileId}/share`, values)).data,
  revoke: async (fileId: string) => {
    await request.delete(`/app/files/${fileId}/share`);
  },
  public: async (token: string, signal?: AbortSignal) =>
    (
      await request.get<PublicShare>(
        `/public/shares/${encodeURIComponent(token)}/content`,
        { signal },
      )
    ).data,
  authenticate: async (token: string, password: string) => {
    await request.post(`/public/shares/${encodeURIComponent(token)}/unlock`, {
      password,
    });
  },
  assetUrl: (token: string, assetId: string, download = false) =>
    `/api/public/shares/${encodeURIComponent(token)}/assets/${encodeURIComponent(assetId)}${download ? "?download=true" : ""}`,
  asset: async (token: string, assetId: string, signal?: AbortSignal) =>
    (
      await request.get<Blob>(
        `/public/shares/${encodeURIComponent(token)}/assets/${encodeURIComponent(assetId)}`,
        { responseType: "blob", signal },
      )
    ).data,
};
export const shareLink = (token: string, location = window.location.href) =>
  `${location.split("#")[0]}#/share/${encodeURIComponent(token)}`;
