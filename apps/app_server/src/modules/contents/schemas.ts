import { Type, type Static } from "@sinclair/typebox";
import { id, errors } from "../spaces/schemas";
export { id, errors };
export const params = Type.Object({ fileId: id });
export const projection = Type.Record(Type.String(), Type.Unknown(), {
  description: "按文档Schema校验的JSON正文投影",
});
export const revision = Type.Integer({
  minimum: 1,
  description: "内容持久化修订",
});
export const epoch = Type.Integer({ minimum: 1, description: "内容世代" });
export const checkpointSchema = Type.Object({
  fileId: id,
  revision,
  epoch,
  savedAt: Type.String({ description: "持久化时间" }),
  versionId: Type.Optional(id),
});
export const contentSchema = Type.Object({
  fileId: id,
  projection,
  revision,
  epoch,
  schemaVersion: Type.Integer({ description: "内容格式版本" }),
  savedAt: Type.String({ description: "持久化时间" }),
});
export const checkpointBody = Type.Object(
  {
    snapshot: Type.Optional(
      Type.Array(Type.Integer({ minimum: 0, maximum: 255 }), {
        maxItems: 1000000,
        description: "Yjs状态快照字节数组，包含状态向量及删除信息",
      }),
    ),
    revision: Type.Optional(revision),
    epoch: Type.Optional(epoch),
    manual: Type.Optional(
      Type.Boolean({ description: "是否生成手动历史检查点" }),
    ),
    note: Type.Optional(
      Type.String({ maxLength: 500, description: "手动版本备注" }),
    ),
  },
  { additionalProperties: false },
);
export type CheckpointBody = Static<typeof checkpointBody>;
export const replaceBody = Type.Object(
  {
    expectedRevision: revision,
    expectedEpoch: epoch,
    projection,
    note: Type.Optional(
      Type.String({ maxLength: 500, description: "导入备注" }),
    ),
  },
  { additionalProperties: false },
);
export type ReplaceBody = Static<typeof replaceBody>;
