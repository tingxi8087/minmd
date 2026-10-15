import { request } from "@/http";
export type RemoteFile = {
  permission?: "read" | "edit" | "manage";
  id: string;
  spaceId: string;
  kind: "doc" | "sheet" | "slide" | "folder" | "pdf" | "video" | "image";
  name: string;
  parentId: string | null;
  position: number;
  createdBy: string;
  visibility: "public" | "private";
  metadataRevision: number;
  deletedBatch: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  favorite?: boolean;
  accessedAt?: string | null;
};
type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
export const filesApi = {
  get: async (id: string, signal?: AbortSignal) =>
    (await request.get<RemoteFile>(`/app/files/${id}`, { signal })).data,
  tree: async (spaceId: string, signal?: AbortSignal) =>
    (
      await request.get<{ items: RemoteFile[] }>(
        `/app/spaces/${spaceId}/tree`,
        { signal },
      )
    ).data.items,
  trash: async (spaceId: string) => {
    const items: RemoteFile[] = [];
    for (let page = 1; ; page++) {
      const result = (
        await request.get<Page<RemoteFile>>(`/app/spaces/${spaceId}/files`, {
          params: { scope: "trash", page, pageSize: 100 },
        })
      ).data;
      items.push(...result.items);
      if (items.length >= result.total || !result.items.length) return items;
    }
  },
  create: async (
    spaceId: string,
    values: { kind: RemoteFile["kind"]; name: string; parentId: string | null },
  ) =>
    (await request.post<RemoteFile>(`/app/spaces/${spaceId}/files`, values))
      .data,
  rename: async (
    spaceId: string,
    id: string,
    name: string,
    expectedMetadataRevision: number,
  ) =>
    (
      await request.patch<RemoteFile>(`/app/files/${id}`, {
        name,
        expectedMetadataRevision,
      })
    ).data,
  move: async (
    spaceId: string,
    id: string,
    parentId: string | null,
    beforeId: string | undefined,
    expectedMetadataRevision: number,
  ) => {
    await request.post(`/app/files/${id}/move`, {
      parentId,
      ...(beforeId ? { beforeId } : {}),
      expectedMetadataRevision,
    });
  },
  remove: async (spaceId: string, id: string) => {
    await request.delete(`/app/files/${id}`);
  },
  restore: async (spaceId: string, id: string, parentId?: string | null) => {
    await request.post(
      `/app/files/${id}/restore`,
      parentId === undefined ? {} : { parentId },
    );
  },
  purge: async (spaceId: string, id: string) => {
    await request.post(`/app/files/${id}/purge`, { confirm: true });
  },
  favorite: async (spaceId: string, id: string, value: boolean) => {
    if (value) await request.put(`/app/files/${id}/favorite`, {});
    else await request.delete(`/app/files/${id}/favorite`);
  },
  visit: async (spaceId: string, id: string) => {
    await request.post(`/app/files/${id}/visit`, {});
  },
};
