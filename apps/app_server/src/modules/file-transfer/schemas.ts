import { Type, type Static } from "@sinclair/typebox";
import { id, errors } from "../spaces/schemas";
export { errors };
const nullableId = Type.Union([id, Type.Null()], {
  description: "目标记录标识，根目录或非替换操作可为空",
});
const revision = Type.Integer({
  minimum: 1,
  description: "当前内容修订或世代",
});
export const transferParams = Type.Object(
  { transferId: id },
  { additionalProperties: false },
);
export const spaceParams = Type.Object(
  { spaceId: id },
  { additionalProperties: false },
);
export const exportBody = Type.Object(
  {
    ids: Type.Array(id, {
      minItems: 1,
      maxItems: 10000,
      uniqueItems: true,
      description: "选中文件；默认递归导出后代",
    }),
    mode: Type.Union([Type.Literal("complete"), Type.Literal("markdown")], {
      description: "完整格式或 Markdown/XLSX 通用格式",
    }),
    single: Type.Optional(
      Type.Boolean({
        default: false,
        description: "仅导出当前一份文档，不包含子文件",
      }),
    ),
  },
  { additionalProperties: false },
);
export const importBody = Type.Object(
  {
    batchId: id,
    parentId: nullableId,
    replaceFileId: nullableId,
    expectedRevision: Type.Optional(revision),
    expectedEpoch: Type.Optional(revision),
  },
  { additionalProperties: false },
);
export const empty = Type.Object({}, { additionalProperties: false });
export const statusSchema = Type.Object(
  {
    id,
    operation: Type.Union([Type.Literal("import"), Type.Literal("export")], {
      description: "导入或导出任务",
    }),
    status: Type.Union(
      ["waiting-upload", "processing", "ready", "completed", "failed"].map(
        (value) => Type.Literal(value),
      ),
      { description: "等待上传、处理中、待确认或下载、已完成、失败" },
    ),
    done: Type.Integer({ minimum: 0, description: "已处理业务条目数" }),
    total: Type.Integer({ minimum: 0, description: "业务条目总数" }),
    expiresAt: Type.String({ description: "临时包过期时间" }),
    filename: Type.Union([Type.String(), Type.Null()], {
      description: "下载文件名称，未生成时为空",
    }),
    mode: Type.Union(
      [Type.Literal("complete"), Type.Literal("markdown"), Type.Null()],
      { description: "完整格式或通用格式，未校验时为空" },
    ),
    fileCount: Type.Integer({ minimum: 0, description: "文件及文件夹数量" }),
    assetCount: Type.Integer({ minimum: 0, description: "去重后的附件数量" }),
    fileIds: Type.Array(id, {
      description: "成功导入的文件标识，未提交时为空",
    }),
    error: Type.Union(
      [
        Type.Object({
          code: Type.String({ description: "业务错误代码" }),
          message: Type.String({ description: "可展示的中文错误说明" }),
        }),
        Type.Null(),
      ],
      { description: "失败原因，正常任务为空" },
    ),
  },
  { description: "当前用户任务状态与处理结果" },
);
export type ExportBody = Static<typeof exportBody>;
export type ImportBody = Static<typeof importBody>;
