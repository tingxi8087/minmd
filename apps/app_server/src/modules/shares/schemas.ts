import { Type, type Static } from "@sinclair/typebox";
import { id, errors } from "../spaces/schemas";
import { contentSchema } from "../contents/schemas";
export { errors };
export const visibility = Type.Union(
  [Type.Literal("public"), Type.Literal("private")],
  { description: "公开或私有" },
);
export const expiresAt = Type.Union(
  [Type.String({ format: "date-time" }), Type.Null()],
  { description: "分享截止时间，null表示永不过期" },
);
export const audience = Type.Union(
  [Type.Literal("authenticated"), Type.Literal("anyone")],
  { description: "公开范围：本站登录用户或所有人" },
);
export const linkPermission = Type.Union(
  [Type.Literal("read"), Type.Literal("edit")],
  { description: "公开链接授予登录用户的权限，访客始终只读" },
);
export const shareStatus = Type.Object({
  audience,
  permission: linkPermission,
  visibility,
  enabled: Type.Boolean({ description: "是否存在未过期且有效的分享" }),
  hasPassword: Type.Boolean({ description: "是否设置访问密码，不返回密码" }),
  expiresAt,
  generation: Type.Integer({ description: "分享授权世代" }),
});
export const params = Type.Object({ fileId: id });
export const token = Type.String({
  pattern: "^[A-Za-z0-9_-]{43}$",
  description: "随机分享Token，不记录完整URL",
});
export const guestParams = Type.Object({ token });
export const body = Type.Object(
  {
    visibility,
    audience: Type.Optional(audience),
    permission: Type.Optional(linkPermission),
    password: Type.Optional(
      Type.Union([Type.String({ minLength: 4, maxLength: 128 }), Type.Null()], {
        description: "密码省略保留、null清除；4–128位",
      }),
    ),
    expiresAt: Type.Optional(expiresAt),
    rotate: Type.Optional(
      Type.Boolean({ description: "重新生成链接，旧Token及访客授权立即失效" }),
    ),
  },
  { additionalProperties: false },
);
export type ShareBody = Static<typeof body>;
export const shareResponse = Type.Object({
  ...shareStatus.properties,
  token: Type.Optional(token),
});
export const publicResponse = Type.Object({
  file: Type.Object(
    {
      id,
      name: Type.String({ description: "文件名称" }),
      kind: Type.Union(
        [
          Type.Literal("doc"),
          Type.Literal("sheet"),
          Type.Literal("slide"),
          Type.Literal("pdf"),
          Type.Literal("video"),
          Type.Literal("image"),
        ],
        { description: "只读文件类型" },
      ),
    },
    { description: "当前分享文件最小资料" },
  ),
  content: { ...contentSchema, description: "当前已持久化正文投影" },
});
export const ok = {
  200: Type.Object({ ok: Type.Boolean({ description: "操作成功" }) }),
  ...errors,
};
