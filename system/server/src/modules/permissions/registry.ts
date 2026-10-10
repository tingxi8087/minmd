import type { Transaction } from "../audit/service";
export type RoleScope = "admin" | "app";
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
export interface PermissionCatalog {
  admin: PermissionGroup[];
  app: PermissionGroup[];
}
export interface RoleMembership {
  /** 业务用户关联由应用提供，系统无需导入业务表。 */
  count: (tx: Transaction, roleId: string) => Promise<number>;
}
export const codesFor = (catalog: PermissionCatalog, scope: RoleScope) =>
  catalog[scope].flatMap((group) => group.permissions.map((p) => p.code));
export function validateCatalog(catalog: PermissionCatalog) {
  const codes = [...codesFor(catalog, "admin"), ...codesFor(catalog, "app")];
  if (new Set(codes).size !== codes.length)
    throw new Error("权限标识不能重复或跨前后台共用");
}
