import { Type, type Static } from "@sinclair/typebox";
export const id = Type.String({ format: "uuid", description: "记录 ID" });
export const fields = {
  name: Type.String({
    minLength: 1,
    maxLength: 80,
    pattern: "\\S",
    description: "空间名称",
  }),
  description: Type.String({ maxLength: 2000, description: "空间说明" }),
};
export const spaceSchema = Type.Object({
  id,
  ...fields,
  ownerId: id,
  createdAt: Type.String({ description: "创建时间" }),
  updatedAt: Type.String({ description: "更新时间" }),
});
export const userSchema = Type.Object({
  id,
  account: Type.String({ description: "账号" }),
  nickname: Type.String({ description: "昵称" }),
  avatar: Type.String({ description: "头像" }),
});
export const spaceParams = Type.Object({ spaceId: id });
export const memberBody = Type.Object(
  { userId: id },
  { additionalProperties: false },
);
export const createBody = Type.Object(
  { name: fields.name, description: Type.Optional(fields.description) },
  { additionalProperties: false },
);
export const patchBody = Type.Object(
  {
    name: Type.Optional(fields.name),
    description: Type.Optional(fields.description),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type CreateBody = Static<typeof createBody>;
export type PatchBody = Static<typeof patchBody>;
export const pagination = Type.Object(
  {
    page: Type.Optional(
      Type.Integer({ minimum: 1, default: 1, description: "页码" }),
    ),
    pageSize: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        default: 50,
        description: "每页条数",
      }),
    ),
  },
  { additionalProperties: false },
);
export const listResponse = Type.Object({
  items: Type.Array(spaceSchema, { description: "空间列表" }),
  total: Type.Integer({ description: "总条数" }),
  page: Type.Integer({ description: "当前页码" }),
  pageSize: Type.Integer({ description: "每页条数" }),
});
export const errors = {
  400: Type.Object({
    code: Type.String({ description: "错误代码" }),
    message: Type.String({ description: "错误说明" }),
    requestId: Type.String({ description: "请求追踪 ID" }),
  }),
  401: Type.Object({
    code: Type.String({ description: "错误代码" }),
    message: Type.String({ description: "错误说明" }),
    requestId: Type.String({ description: "请求追踪 ID" }),
  }),
  403: Type.Object({
    code: Type.String({ description: "错误代码" }),
    message: Type.String({ description: "错误说明" }),
    requestId: Type.String({ description: "请求追踪 ID" }),
  }),
  404: Type.Object({
    code: Type.String({ description: "错误代码" }),
    message: Type.String({ description: "错误说明" }),
    requestId: Type.String({ description: "请求追踪 ID" }),
  }),
  413: Type.Object(
    {
      code: Type.String({ description: "错误代码" }),
      message: Type.String({ description: "请求或内容超过大小限制的说明" }),
      requestId: Type.String({ description: "请求追踪 ID" }),
    },
    { description: "请求体、协作投影或附件超过允许大小" },
  ),
  409: Type.Object({
    currentRevision: Type.Optional(
      Type.Integer({ minimum: 1, description: "冲突时的当前内容修订号" }),
    ),
    currentEpoch: Type.Optional(
      Type.Integer({ minimum: 1, description: "冲突时的当前内容世代" }),
    ),
    code: Type.String({ description: "错误代码" }),
    message: Type.String({ description: "错误说明" }),
    requestId: Type.String({ description: "请求追踪 ID" }),
  }),
};
export const ok = {
  200: Type.Object({ ok: Type.Boolean({ description: "操作成功" }) }),
  ...errors,
};
