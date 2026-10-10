import { request } from "@/http";
export type RoleScope = "admin" | "app";
export interface Role {
  scope: RoleScope;
  id: string;
  code: string;
  name: string;
  description: string;
  permissions: string[];
  members: number;
}
export interface PermissionGroup {
  code: string;
  name: string;
  permissions: {
    code: string;
    name: string;
    description: string;
    write: boolean;
  }[];
}
export const getPermissionGroups = (scope: RoleScope = "admin") =>
  request.get<never, { groups: PermissionGroup[] }>("/api/admin/permissions", {
    params: { scope },
  });
export const getRoles = (params: Record<string, unknown> = {}) =>
  request.get<
    never,
    { items: Role[]; total: number; page: number; pageSize: number }
  >("/api/admin/roles", {
    params,
  });
export const saveRole = (role: Role) => {
  const { code, name, description, permissions, scope } = role;
  return role.id
    ? request.put(`/api/admin/roles/${role.id}`, {
        scope,
        code,
        name,
        description,
        permissions,
      })
    : request.post("/api/admin/roles", {
        scope,
        code,
        name,
        description,
        permissions,
      });
};
export const deleteRole = (id: string) =>
  request.delete(`/api/admin/roles/${id}`);
