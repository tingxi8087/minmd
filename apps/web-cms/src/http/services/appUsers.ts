import { request } from "@/http";
export interface AppUser {
  id: string;
  account: string;
  nickname: string;
  avatar: string;
  status: "enabled" | "disabled";
  metadata: Record<string, unknown>;
  roles: string[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}
export type AppUserInput = Pick<
  AppUser,
  "account" | "nickname" | "avatar" | "metadata" | "roles"
> & { password?: string };
export const getAppUsers = (params: Record<string, unknown>) =>
  request.get<never, { items: AppUser[]; total: number; page: number }>(
    "/api/admin/app-users",
    { params },
  );
export const saveAppUser = (values: AppUserInput, id?: string) =>
  id
    ? request.put(`/api/admin/app-users/${id}`, values)
    : request.post("/api/admin/app-users", values);
export const userAction = (
  id: string,
  action: "status" | "password" | "revoke",
  body: Record<string, unknown> = {},
) => request.post(`/api/admin/app-users/${id}/${action}`, body);
export const getAppRoleOptions = () =>
  request.get<never, { items: { value: string; label: string }[] }>(
    "/api/admin/role-options",
    { params: { scope: "app" } },
  );
