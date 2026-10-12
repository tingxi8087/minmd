import { request } from "@/http";
import type { RemoteFile } from "./files";
export type Permission = "read" | "edit";
export type FileAccess = {
  permission: Permission | "manage" | null;
  member: boolean;
  request: {
    id: string;
    permission: Permission;
    status: "pending" | "approved" | "rejected" | "cancelled";
  } | null;
};
export type Collaborator = { id: string; account: string; nickname: string };
export type AccessSettings = {
  memberPermission: Permission;
  grants: { user: Collaborator; permission: Permission }[];
  requests: {
    id: string;
    user: Collaborator;
    permission: Permission;
    reason: string;
    createdAt: string;
    status: string;
  }[];
};
export type Notification = {
  id: string;
  fileId: string | null;
  message: string;
  readAt: string | null;
  createdAt: string;
};
export const fileAccessApi = {
  access: async (id: string, signal?: AbortSignal) =>
    (await request.get<FileAccess>(`/app/files/${id}/access`, { signal })).data,
  file: async (id: string, signal?: AbortSignal) =>
    (await request.get<RemoteFile>(`/app/files/${id}`, { signal })).data,
  settings: async (id: string) =>
    (await request.get<AccessSettings>(`/app/files/${id}/access-settings`))
      .data,
  memberPermission: async (id: string, permission: Permission) => {
    await request.put(`/app/files/${id}/member-permission`, { permission });
  },
  grant: async (id: string, userId: string, permission: Permission) => {
    await request.put(`/app/files/${id}/access-grants`, { userId, permission });
  },
  removeGrant: async (id: string, userId: string) => {
    await request.delete(`/app/files/${id}/access-grants/${userId}`);
  },
  search: async (q: string) =>
    (
      await request.get<{ items: Collaborator[] }>("/app/users/search", {
        params: { q },
      })
    ).data.items,
  apply: async (id: string, permission: Permission, reason: string) => {
    await request.post(`/app/files/${id}/access-requests`, {
      permission,
      reason,
    });
  },
  cancel: async (id: string) => {
    await request.delete(`/app/files/${id}/access-request`);
  },
  decide: async (
    id: string,
    requestId: string,
    decision: "approve" | "reject",
    permission?: Permission,
  ) => {
    await request.post(
      `/app/files/${id}/access-requests/${requestId}/decision`,
      { decision, ...(permission ? { permission } : {}) },
    );
  },
  sharedWithMe: async () =>
    (await request.get<{ items: RemoteFile[] }>("/app/shared-with-me")).data
      .items,
  notifications: async (page = 1) =>
    (
      await request.get<{
        items: Notification[];
        total: number;
        unreadCount: number;
        page: number;
        pageSize: number;
      }>("/app/notifications", { params: { page, pageSize: 20 } })
    ).data,
  readNotification: async (id: string) => {
    await request.put(`/app/notifications/${id}/read`, {});
  },
};

export const FILE_ACCESS_CHANGED = "minmd-file-access-changed";
export function notifyFileAccessChanged(fileId: string) {
  if (typeof window.dispatchEvent === "function")
    window.dispatchEvent(
      new CustomEvent(FILE_ACCESS_CHANGED, { detail: fileId }),
    );
}
