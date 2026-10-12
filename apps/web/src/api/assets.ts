import { request } from "@/http";
export type Asset = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  slides: number;
  url: string;
};
export type PresentationProjection = {
  assetId?: string;
  name?: string;
  size?: number;
  slides?: number;
};
export type PresentationContent = {
  fileId: string;
  revision: number;
  epoch: number;
  projection: PresentationProjection;
  savedAt?: string;
};
export const ASSET_TRANSFER_TIMEOUT_MS = 120_000;
export const assetsApi = {
  upload: async (
    spaceId: string,
    file: File,
    signal?: AbortSignal,
    fileId?: string,
  ) => {
    const body = new FormData();
    body.set("file", file);
    return (
      await request.post<Asset>(
        fileId
          ? `/app/files/${fileId}/assets`
          : `/app/spaces/${spaceId}/assets`,
        body,
        {
          signal,
          timeout: ASSET_TRANSFER_TIMEOUT_MS,
        },
      )
    ).data;
  },
  download: async (assetId: string, signal?: AbortSignal) =>
    (
      await request.get<Blob>(`/app/assets/${assetId}`, {
        responseType: "blob",
        signal,
        timeout: ASSET_TRANSFER_TIMEOUT_MS,
      })
    ).data,
  presentation: async (fileId: string, signal?: AbortSignal) =>
    (
      await request.get<PresentationContent>(`/app/files/${fileId}/content`, {
        signal,
      })
    ).data,
  bindPresentation: async (
    fileId: string,
    assetId: string,
    basis: Pick<PresentationContent, "revision" | "epoch">,
    signal?: AbortSignal,
  ) =>
    (
      await request.put<PresentationContent>(
        `/app/files/${fileId}/presentation`,
        {
          assetId,
          expectedRevision: basis.revision,
          expectedEpoch: basis.epoch,
        },
        { signal },
      )
    ).data,
};
