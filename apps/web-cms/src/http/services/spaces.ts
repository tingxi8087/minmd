import { request } from "@/http";
export interface ManagedSpace {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}
export interface ManagedMember {
  id: string;
  account: string;
  nickname: string;
  avatar: string;
  role: "owner" | "member";
  joinedAt: string;
}
export const getSpaces = (params: { page: number; pageSize: number }) =>
  request.get<never, { items: ManagedSpace[]; total: number; page: number }>(
    "/api/admin/spaces",
    { params },
  );
export const saveSpace = (
  values: { name: string; description: string; ownerId?: string },
  id?: string,
) =>
  id
    ? request.patch(`/api/admin/spaces/${id}`, {
        name: values.name,
        description: values.description,
      })
    : request.post("/api/admin/spaces", values);
export const getSpaceMembers = (id: string, page = 1) =>
  request.get<never, { items: ManagedMember[]; total: number; page: number }>(
    `/api/admin/spaces/${id}/members`,
    { params: { page, pageSize: 100 } },
  );
export const addSpaceMember = (id: string, userId: string) =>
  request.post(`/api/admin/spaces/${id}/members`, { userId });
export const removeSpaceMember = (id: string, userId: string) =>
  request.delete(`/api/admin/spaces/${id}/members/${userId}`);
export const transferSpaceOwner = (id: string, userId: string) =>
  request.post(`/api/admin/spaces/${id}/transfer-owner`, { userId });
