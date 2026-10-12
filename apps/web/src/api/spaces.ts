import { request } from "@/http";
export type Space = {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};
export type SpaceMember = {
  id: string;
  account: string;
  nickname: string;
  avatar: string;
  joinedAt: string;
  role: "owner" | "member";
};
type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
export const spaceApi = {
  list: async () => {
    const items: Space[] = [];
    for (let page = 1; ; page++) {
      const result = (
        await request.get<Page<Space>>("/app/spaces", {
          params: { page, pageSize: 100 },
        })
      ).data;
      items.push(...result.items);
      if (items.length >= result.total || !result.items.length) return items;
    }
  },
  create: async (name: string) =>
    (await request.post<Space>("/app/spaces", { name })).data,
  update: async (id: string, name: string, signal?: AbortSignal) =>
    (await request.patch<Space>(`/app/spaces/${id}`, { name }, { signal }))
      .data,
  members: async (id: string, page: number, signal?: AbortSignal) =>
    (
      await request.get<Page<SpaceMember>>(`/app/spaces/${id}/members`, {
        params: { page, pageSize: 100 },
        signal,
      })
    ).data,
  accounts: async (id: string, q: string, signal?: AbortSignal) =>
    (
      await request.get<{
        items: Pick<SpaceMember, "id" | "account" | "nickname" | "avatar">[];
      }>(`/app/spaces/${id}/accounts`, { params: { q }, signal })
    ).data,
  addMember: async (id: string, userId: string, signal?: AbortSignal) => {
    await request.post(`/app/spaces/${id}/members`, { userId }, { signal });
  },
  removeMember: async (id: string, userId: string, signal?: AbortSignal) => {
    await request.delete(`/app/spaces/${id}/members/${userId}`, { signal });
  },
  transfer: async (id: string, userId: string, signal?: AbortSignal) => {
    await request.post(
      `/app/spaces/${id}/transfer-owner`,
      { userId },
      { signal },
    );
  },
};
