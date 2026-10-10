import dayjs from "dayjs";
import { demoRoles } from "./adminPreview";

/** 控制台管理员账号，纯内存演示，与业务用户独立。 */
export interface AdminAccount {
  id: number;
  account: string;
  name: string;
  roles: string[];
  status: "enabled" | "disabled";
  lastLoginAt?: string;
  createdAt: string;
}
export type AdminInput = Omit<AdminAccount, "id" | "lastLoginAt" | "createdAt">;
export interface AdminSearchParams {
  name?: string;
  account?: string;
  status?: AdminAccount["status"];
  roles?: string[];
  registered?: [string, string];
}
export const roleOptions = demoRoles.map((role) => ({
  label: role.name,
  value: role.id,
}));
export const roleName = (id: string) =>
  roleOptions.find((role) => role.value === id)?.label || id;
export const statusOptions = [
  { label: "启用", value: "enabled" },
  { label: "停用", value: "disabled" },
];
const rows: AdminAccount[] = Array.from({ length: 29 }, (_, i) => ({
  id: i + 1,
  account: `web_cms_${String(i + 1).padStart(3, "0")}`,
  name: `${["开发", "运维", "测试"][i % 3]}成员 ${String(i + 1).padStart(2, "0")}`,
  roles: [roleOptions[i % roleOptions.length].value],
  status: i % 7 === 6 ? "disabled" : "enabled",
  lastLoginAt:
    i % 5 === 4
      ? undefined
      : `2026-09-${String(17 - (i % 10)).padStart(2, "0")} 09:30:00`,
  createdAt: `2026-08-${String(1 + (i % 27)).padStart(2, "0")} 10:00:00`,
}));
let nextId = 30;
const matches = (text: string, query?: string) =>
  !query || text.toLowerCase().includes(query.trim().toLowerCase());
export async function getAdminAccounts(
  query: AdminSearchParams & { pageNum?: number; pageSize?: number },
) {
  const filtered = rows.filter(
    (row) =>
      matches(row.name, query.name) &&
      matches(row.account, query.account) &&
      (!query.status || row.status === query.status) &&
      (!query.roles?.length ||
        query.roles.some((role) => row.roles.includes(role))) &&
      (!query.registered?.[0] ||
        row.createdAt.slice(0, 10) >= query.registered[0]) &&
      (!query.registered?.[1] ||
        row.createdAt.slice(0, 10) <= query.registered[1]),
  );
  const pageSize = query.pageSize || 5;
  const pageNum = Math.max(
    1,
    Math.min(query.pageNum || 1, Math.ceil(filtered.length / pageSize) || 1),
  );
  return {
    data: {
      list: structuredClone(
        filtered.slice((pageNum - 1) * pageSize, pageNum * pageSize),
      ),
      total: filtered.length,
      pageNum,
      pageSize,
    },
  };
}
function clean(input: AdminInput, id?: number): AdminInput {
  const account = input.account?.trim();
  if (
    !input.name?.trim() ||
    !/^[a-zA-Z][a-zA-Z0-9_]{2,19}$/.test(account || "")
  )
    throw new Error("请填写显示名称和有效账号");
  if (
    rows.some(
      (row) =>
        row.id !== id && row.account.toLowerCase() === account.toLowerCase(),
    )
  )
    throw new Error("账号已存在，请更换账号");
  if (
    !input.roles?.length ||
    input.roles.some(
      (role) => !roleOptions.some((option) => option.value === role),
    )
  )
    throw new Error("请选择有效角色");
  return {
    name: input.name.trim(),
    account,
    roles: [...input.roles],
    status: input.status,
  };
}
export async function addAdminAccount(input: AdminInput) {
  rows.unshift({
    ...clean(input),
    id: nextId++,
    createdAt: dayjs().format("YYYY-MM-DD HH:mm:ss"),
  });
}
export async function updateAdminAccount(input: AdminInput & { id: number }) {
  const row = rows.find((row) => row.id === input.id);
  if (!row) throw new Error("管理员账号不存在");
  Object.assign(row, clean(input, input.id));
}
export async function deleteAdminAccount(id: number) {
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) throw new Error("管理员账号不存在");
  rows.splice(index, 1);
}
export async function setAdminStatus(
  ids: number[],
  status: AdminAccount["status"],
) {
  rows.forEach((row) => {
    if (ids.includes(row.id)) row.status = status;
  });
}
