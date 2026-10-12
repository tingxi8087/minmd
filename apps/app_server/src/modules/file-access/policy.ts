export type FilePermission = "read" | "edit" | "manage";
export const permissionRank = (value: FilePermission | null) =>
  value === "manage" ? 3 : value === "edit" ? 2 : value === "read" ? 1 : 0;
/** 成员显式授权覆盖空间默认值；公开链接是额外授权，不能用于降低既有权限。 */
export function resolvePermission(input: {
  manager: boolean;
  member: boolean;
  memberPermission: "read" | "edit";
  grant?: "read" | "edit";
  publicPermission?: "read" | "edit";
}): FilePermission | null {
  if (input.manager) return "manage";
  const direct = input.grant ?? (input.member ? input.memberPermission : null);
  return permissionRank(input.publicPermission ?? null) > permissionRank(direct)
    ? input.publicPermission!
    : direct;
}
