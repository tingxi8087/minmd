import { Type } from "@sinclair/typebox";
export const uuid = Type.String({ format: "uuid", description: "记录 ID" });
export const params = Type.Object({ id: uuid });
export const account = Type.String({
  pattern: "^[a-zA-Z][a-zA-Z0-9_]{2,63}$",
  description: "登录账号，3–64 位字母数字下划线，以字母开头",
  example: "demo_user",
});
export const password = Type.String({
  minLength: 12,
  maxLength: 128,
  description: "密码，12–128 位",
});
export const profile = {
  nickname: Type.String({
    maxLength: 64,
    description: "昵称",
    example: "小明",
  }),
  avatar: Type.String({
    maxLength: 1000,
    pattern: "^(https?://[^\\s]+|/[^/\\s][^\\s]*|)$",
    description: "头像 HTTP(S) 地址或站内路径，可为空",
  }),
};
export const status = Type.Union(
  [Type.Literal("enabled"), Type.Literal("disabled")],
  { description: "账号状态" },
);
export const roleIds = Type.Array(uuid, {
  uniqueItems: true,
  maxItems: 50,
  description: "前台角色 ID",
});
export const metadata = Type.Record(Type.String(), Type.Unknown(), {
  description: "额外资料 JSON 对象，仅由后台维护",
});
export const userSchema = Type.Object({
  id: uuid,
  account,
  ...profile,
  status,
  metadata,
  roles: roleIds,
  createdAt: Type.String({ description: "创建时间" }),
  updatedAt: Type.String({ description: "更新时间" }),
  lastLoginAt: Type.Union([Type.String(), Type.Null()], {
    description: "最近登录时间",
  }),
});
export const ok = {
  200: Type.Object({ ok: Type.Boolean({ description: "操作成功" }) }),
};
export const empty = Type.Object({}, { additionalProperties: false });
export const adminFields = { account, ...profile, metadata, roles: roleIds };
export interface UserInput {
  account: string;
  nickname: string;
  avatar: string;
  metadata: Record<string, unknown>;
  roles: string[];
}
