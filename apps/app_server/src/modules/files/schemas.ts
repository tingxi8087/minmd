import { Type, type Static } from "@sinclair/typebox";
import { id, pagination, errors } from "../spaces/schemas";
export { errors };
export const kind = Type.Union(
  [
    Type.Literal("doc"),
    Type.Literal("sheet"),
    Type.Literal("slide"),
    Type.Literal("folder"),
  ],
  { description: "文件类型" },
);
export const nullableId = Type.Union([id, Type.Null()], {
  description: "父节点 ID，null 表示根目录",
});
export const name = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: "\\S",
  description: "文件名称",
});
export const revision = Type.Integer({
  minimum: 1,
  description: "预期元数据修订，变更冲突返回409",
});
export const fileSchema = Type.Object({
  id,
  favorite: Type.Boolean({ description: "当前账号是否收藏" }),
  accessedAt: Type.Union([Type.String(), Type.Null()], {
    description: "当前账号最近访问时间",
  }),
  spaceId: id,
  kind,
  name,
  parentId: nullableId,
  position: Type.Number({ description: "同级排序位置" }),
  createdBy: id,
  visibility: Type.Union([Type.Literal("public"), Type.Literal("private")], {
    description: "公开或私有可见性",
  }),
  metadataRevision: revision,
  deletedBatch: Type.Union([id, Type.Null()], { description: "删除批次" }),
  deletedAt: Type.Union([Type.String(), Type.Null()], {
    description: "删除时间",
  }),
  createdAt: Type.String({ description: "创建时间" }),
  updatedAt: Type.String({ description: "更新时间" }),
});
export const fileParams = Type.Object({ fileId: id });
export const spaceParams = Type.Object({ spaceId: id });
export const createBody = Type.Object(
  { kind, name, parentId: Type.Optional(nullableId) },
  { additionalProperties: false },
);
export const patchBody = Type.Object(
  { name, expectedMetadataRevision: revision },
  { additionalProperties: false },
);
export const moveBody = Type.Object(
  {
    parentId: nullableId,
    beforeId: Type.Optional(id),
    expectedMetadataRevision: revision,
  },
  { additionalProperties: false },
);
export const restoreBody = Type.Object(
  { parentId: Type.Optional(nullableId) },
  { additionalProperties: false },
);
export const empty = Type.Object({}, { additionalProperties: false });
export const ok = {
  200: Type.Object({ ok: Type.Boolean({ description: "操作成功" }) }),
  ...errors,
};
export const query = Type.Object(
  {
    ...pagination.properties,
    parentId: Type.Optional(
      Type.Union([id, Type.Literal("root")], {
        description: "父节点 ID 或 root",
      }),
    ),
    scope: Type.Optional(
      Type.Union(
        [
          Type.Literal("all"),
          Type.Literal("favorites"),
          Type.Literal("recent"),
          Type.Literal("trash"),
        ],
        { description: "查询范围" },
      ),
    ),
    kind: Type.Optional(kind),
    q: Type.Optional(
      Type.String({ maxLength: 100, description: "名称关键词" }),
    ),
  },
  { additionalProperties: false },
);
export type FilesQuery = Static<typeof query>;
export type CreateBody = Static<typeof createBody>;
export type PatchBody = Static<typeof patchBody>;
export type MoveBody = Static<typeof moveBody>;
export type RestoreBody = Static<typeof restoreBody>;
export const listSchema = Type.Object({
  items: Type.Array(fileSchema, { description: "文件元数据列表" }),
  total: Type.Integer({ description: "总条数" }),
  page: Type.Integer({ description: "当前页码" }),
  pageSize: Type.Integer({ description: "每页条数" }),
});
