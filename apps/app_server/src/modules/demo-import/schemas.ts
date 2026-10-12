import { Type, type Static } from "@sinclair/typebox";
import { id, errors } from "../spaces/schemas";
export { errors };
export const oldId = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: "^[A-Za-z0-9_-]+$",
  description: "原本地文件ID，允许字母数字下划线和短横线",
});
export const entry = Type.Object(
  {
    oldId,
    kind: Type.Union(
      [
        Type.Literal("folder"),
        Type.Literal("doc"),
        Type.Literal("slide"),
        Type.Literal("sheet"),
      ],
      { description: "原文件类型" },
    ),
    name: Type.String({
      minLength: 1,
      maxLength: 200,
      description: "文件名称",
    }),
    parentOldId: Type.Optional(
      Type.Union([oldId, Type.Null()], {
        description: "旧父文件ID，省略或null表示空间根目录",
      }),
    ),
    projection: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), {
        description:
          "经过服务端结构校验的局部引擎投影；图片和PPT需先上传私有附件",
      }),
    ),
    missingAssets: Type.Optional(
      Type.Boolean({ description: "本地附件缺失，返回失败结果且不创建空文件" }),
    ),
  },
  {
    additionalProperties: false,
    description: "单个演示文件；不接受演示账号、分享或密钥",
  },
);
export const body = Type.Object(
  {
    idempotencyKey: Type.String({
      minLength: 16,
      maxLength: 100,
      pattern: "^[A-Za-z0-9_-]+$",
      description: "当前账号和目标空间范围内的幂等键",
    }),
    entries: Type.Array(entry, {
      minItems: 1,
      maxItems: 200,
      description:
        "完整迁移清单；重试仅更正失败项的正文或补充附件，元数据保持相同",
    }),
  },
  { additionalProperties: false },
);
export type Entry = Static<typeof entry>;
export type ImportBody = Static<typeof body>;
export const response = Type.Object({
  jobId: id,
  status: Type.Union([Type.Literal("completed"), Type.Literal("partial")], {
    description: "全部完成或仍有失败项",
  }),
  mapping: Type.Record(oldId, id, {
    description: "旧ID到预分配服务端UUID的映射；失败项UUID尚未创建",
  }),
  items: Type.Array(
    Type.Object(
      {
        oldId,
        fileId: id,
        status: Type.Union([Type.Literal("success"), Type.Literal("failed")], {
          description: "单个文件导入结果",
        }),
        message: Type.String({
          description: "成功或可重试失败原因，不包含原始数据库异常",
        }),
      },
      { description: "单个迁移结果" },
    ),
    { description: "文件结果，缺失附件明确失败" },
  ),
});
