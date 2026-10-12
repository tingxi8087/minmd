import { request } from "@/http";
export const aiPermissionNames = {
  read: "读取文件与内容",
  create: "创建文件与文件夹",
  edit: "修改文档与表格内容",
  organize: "重命名与移动文件",
  delete_restore: "删除与恢复文件",
  upload: "上传图片与文件",
} as const;
export type AiPermission = keyof typeof aiPermissionNames;
export type ApiKey = {
  id: string;
  spaceId: string;
  createdBy: string;
  name: string;
  prefix: string;
  permissions: AiPermission[];
  canReveal: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};
export const aiApi = {
  keys: async (spaceId: string, signal?: AbortSignal) =>
    (
      await request.get<{ items: ApiKey[] }>(
        `/app/spaces/${spaceId}/api-keys`,
        { signal },
      )
    ).data.items,
  create: async (
    spaceId: string,
    input: {
      name: string;
      permissions: AiPermission[];
      expiresAt: string | null;
    },
  ) =>
    (
      await request.post<{ key: ApiKey; secret: string }>(
        `/app/spaces/${spaceId}/api-keys`,
        input,
      )
    ).data,
  update: async (
    keyId: string,
    input: {
      name: string;
      permissions: AiPermission[];
      expiresAt: string | null;
    },
  ) => (await request.patch<ApiKey>(`/app/api-keys/${keyId}`, input)).data,
  reveal: async (keyId: string) =>
    (
      await request.post<{ secret: string }>(
        `/app/api-keys/${keyId}/reveal`,
        {},
      )
    ).data.secret,
  revoke: async (keyId: string) => {
    await request.delete(`/app/api-keys/${keyId}`);
  },
};
export function aiTemplates(origin: string) {
  return {
    http: `curl '${origin}/api/v1/files' \\\n  -H 'Authorization: Bearer <API_KEY>'`,
    mcp: JSON.stringify(
      {
        mcpServers: {
          minmd: {
            url: `${origin}/mcp`,
            headers: { Authorization: "Bearer <API_KEY>" },
          },
        },
      },
      null,
      2,
    ),
  };
}
