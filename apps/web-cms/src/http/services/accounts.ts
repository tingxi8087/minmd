import { request } from "@/http";
import dayjs from "dayjs";
export interface AdminAccount {
  id: string;
  account: string;
  name: string;
  roles: string[];
  status: "enabled" | "disabled";
  isSuperAdmin: boolean;
  lastLoginAt?: string;
  createdAt: string;
}
export type AdminInput = Pick<AdminAccount, "account" | "name" | "roles"> & {
  password?: string;
};
export interface AdminSearchParams {
  name?: string;
  roles?: string[];
  registered?: [string, string];
  account?: string;
  status?: AdminAccount["status"];
}
export const statusOptions = [
  { label: "启用", value: "enabled" },
  { label: "停用", value: "disabled" },
];
export async function getAdminAccounts(
  query: AdminSearchParams & { pageNum?: number; pageSize?: number },
) {
  const { pageNum, roles, registered, ...params } = query;
  const result = await request.get<
    never,
    {
      items: (Omit<AdminAccount, "name"> & { displayName: string })[];
      total: number;
      page: number;
      pageSize: number;
    }
  >("/api/admin/accounts", {
    params: {
      ...params,
      page: pageNum,
      roles: roles?.length ? roles.join(",") : undefined,
      from: registered?.[0]
        ? dayjs(registered[0]).startOf("day").toISOString()
        : undefined,
      to: registered?.[1]
        ? dayjs(registered[1]).endOf("day").toISOString()
        : undefined,
    },
  });
  return {
    data: {
      list: result.items.map((row) => ({
        ...row,
        name: row.displayName,
        createdAt: dayjs(row.createdAt).format("YYYY-MM-DD HH:mm:ss"),
        lastLoginAt: row.lastLoginAt
          ? dayjs(row.lastLoginAt).format("YYYY-MM-DD HH:mm:ss")
          : undefined,
      })),
      total: result.total,
      pageNum: result.page,
      pageSize: result.pageSize,
    },
  };
}
export const getRoleOptions = () =>
  request.get<never, { items: { value: string; label: string }[] }>(
    "/api/admin/role-options",
  );
export const addAdminAccount = (input: AdminInput) =>
  request.post("/api/admin/accounts", {
    account: input.account,
    displayName: input.name,
    roles: input.roles,
    password: input.password,
  });
export const updateAdminAccount = (input: AdminInput & { id: string }) =>
  request.put(`/api/admin/accounts/${input.id}`, {
    account: input.account,
    displayName: input.name,
    roles: input.roles,
  });
export const setAdminStatus = (ids: string[], status: AdminAccount["status"]) =>
  request.post("/api/admin/accounts/status", { ids, status });
export const resetAdminPassword = (id: string, password: string) =>
  request.post(`/api/admin/accounts/${id}/password`, { password });
