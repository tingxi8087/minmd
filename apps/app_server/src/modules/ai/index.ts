import { aiErrors as errors } from "./schemas";
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import type { Database } from "../../../../../system/server/src/database/client";
import { AppError } from "../../../../../system/server/src/errors";
import type { DocumentRooms } from "../collaboration/document-room";
import type { DocumentCommand } from "../collaboration/document-commands";
import { id, pagination } from "../spaces/schemas";
import { listSchema } from "../files/schemas";
import {
  projection,
  checkpointSchema,
  revision,
  epoch,
} from "../contents/schemas";
import { AiService } from "./service";
import { registerAiFiles } from "./files";
import type { SheetRooms } from "../collaboration/sheet-room";
import {
  workbookReadSchema,
  workbookUpdateSchema,
  workbookHttpSchema,
  type WorkbookRead,
  type WorkbookUpdate,
} from "./workbook";

const blockId = Type.String({
  minLength: 1,
  maxLength: 100,
  description: "稳定内容块ID，来自读取结果",
});
const blocks = Type.Array(
  Type.Record(Type.String(), Type.Unknown(), {
    description: "由服务端文档Schema验证的内容块",
  }),
  {
    minItems: 1,
    maxItems: 100,
    description: "新块内容，格式由本次完整块替换决定",
  },
);
const markdownBlocks = Type.String({
  minLength: 1,
  maxLength: 131072,
  description: "Markdown新块，服务端解析；与blocks互斥，UTF-8最多128KiB",
});
const blockInputOptions = {
  additionalProperties: false,
  oneOf: [{ required: ["blocks"] }, { required: ["markdown"] }],
};
const operation = Type.Union(
  [
    Type.Object(
      {
        type: Type.Literal("replace_text", { description: "精确文字替换" }),
        blockId,
        oldText: Type.String({
          minLength: 1,
          maxLength: 10000,
          description: "块内唯一匹配的旧文字",
        }),
        newText: Type.String({
          maxLength: 10000,
          description: "新文字，保留旧文字格式",
        }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        type: Type.Literal("insert_blocks", { description: "插入新块" }),
        parentBlockId: Type.Optional(
          Type.Union([blockId, Type.Null()], {
            description: "父块ID，空值表示根目录",
          }),
        ),
        beforeBlockId: Type.Optional(blockId),
        blocks: Type.Optional(blocks),
        markdown: Type.Optional(markdownBlocks),
      },
      blockInputOptions,
    ),
    Type.Object(
      {
        type: Type.Literal("replace_block", { description: "整体替换单块" }),
        blockId,
        blocks: Type.Optional(blocks),
        markdown: Type.Optional(markdownBlocks),
      },
      blockInputOptions,
    ),
    Type.Object(
      {
        type: Type.Literal("delete_block", { description: "删除指定内容块" }),
        blockId,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        type: Type.Literal("set_block_type", { description: "改变块类型" }),
        blockId,
        nodeType: Type.String({
          minLength: 1,
          maxLength: 50,
          description: "目标文档节点类型",
        }),
        attrs: Type.Optional(
          Type.Record(Type.String(), Type.Unknown(), {
            description: "经文档Schema验证的目标节点属性",
          }),
        ),
      },
      { additionalProperties: false },
    ),
  ],
  { description: "文档局部命令，不使用段落序号定位" },
);
const updateBody = Type.Object(
  {
    expectedRevision: revision,
    expectedEpoch: epoch,
    requestId: Type.String({
      minLength: 8,
      maxLength: 100,
      pattern: "^[a-zA-Z0-9_-]+$",
      description: "当前密钥唯一幂等键，同键不同请求报冲突",
    }),
    operations: Type.Array(operation, {
      minItems: 1,
      maxItems: 100,
      description: "全部通过校验后原子提交的命令批次",
    }),
  },
  { additionalProperties: false },
);
/** HTTP和MCP共享此服务，浏览器Cookie不能代替显式API密钥。 */
export async function registerAi(
  app: FastifyInstance,
  database: Database,
  documents: DocumentRooms,
  sheets: SheetRooms,
  assetStorageDir = "",
  executionTimeoutMs = 15000,
) {
  const service = new AiService(
    database,
    documents,
    sheets,
    assetStorageDir,
    executionTimeoutMs,
  );
  const params = Type.Object({ fileId: id });
  const config = {
    auth: false,
    rateLimit: { max: 60, timeWindow: "1 minute" },
  };
  const token = (value?: string) => {
    if (!value?.startsWith("Bearer "))
      throw new AppError("API_KEY_REQUIRED", "请使用Bearer API密钥", 401);
    return value.slice(7);
  };
  app.get<{
    Querystring: {
      page?: number;
      pageSize?: number;
      search?: string;
      parentId?: string;
    };
  }>(
    "/api/v1/files",
    {
      config,
      schema: {
        tags: ["外部AI文件"],
        summary: "列出或搜索密钥绑定空间文件",
        description:
          "仅read授权API密钥，空间隐含在密钥中，不接受跨空间参数。返回元数据分页，不返回历史或回收站内容。",
        querystring: Type.Object(
          {
            ...pagination.properties,
            search: Type.Optional(
              Type.String({
                minLength: 1,
                maxLength: 200,
                description: "文件名称搜索",
              }),
            ),
            parentId: Type.Optional(id),
          },
          { additionalProperties: false },
        ),
        response: { 200: listSchema, ...errors, 429: errors[400] },
      },
    },
    (request) =>
      service.listFiles(token(request.headers.authorization), request.query),
  );
  app.get<{ Params: { fileId: string }; Querystring: { blockIds?: string[] } }>(
    "/api/v1/files/:fileId/document",
    {
      config,
      schema: {
        tags: ["外部AI文档"],
        summary: "读取文档稳定块与修订",
        description:
          "仅绑定空间的Bearer API密钥可读取；每次请求实时检查创建者成员资格、账号状态、密钥有效期及密钥权限。返回持久化检查点，可指定稳定块ID分批读取。",
        params,
        querystring: Type.Object(
          {
            blockIds: Type.Optional(
              Type.Array(blockId, {
                minItems: 1,
                maxItems: 100,
                uniqueItems: true,
                description: "可选目标块集合",
              }),
            ),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            fileId: id,
            revision,
            epoch,
            schemaVersion: Type.Integer({ description: "文档格式版本" }),
            projection,
          }),
          ...errors,
          413: errors[400],
          429: errors[400],
        },
      },
    },
    (request) =>
      service.readDocument(
        token(request.headers.authorization),
        request.params.fileId,
        request.query.blockIds,
      ),
  );
  app.patch<{ Params: { fileId: string }; Body: Static<typeof updateBody> }>(
    "/api/v1/files/:fileId/document",
    {
      config,
      schema: {
        tags: ["外部AI文档"],
        summary: "原子修改文档局部内容",
        description:
          "仅edit授权API密钥操作；在权威协作队列检查预期revision和epoch，全部命令先验证再原子写入正文、历史与幂等结果，持久化后广播给在线页面。此操作不切换epoch。",
        params,
        body: updateBody,
        response: {
          200: Type.Object({
            ...checkpointSchema.properties,
            touchedBlockIds: Type.Array(blockId, {
              description: "本次受影响的稳定内容块",
            }),
          }),
          ...errors,
          429: errors[400],
        },
      },
    },
    (request) =>
      service.updateDocument(
        token(request.headers.authorization),
        request.params.fileId,
        {
          ...request.body,
          operations: request.body.operations as DocumentCommand[],
        },
      ),
  );
  const sheetId = Type.String({
    minLength: 1,
    maxLength: 100,
    description: "稳定工作表ID",
  });
  const coordinate = Type.Integer({ minimum: 0, description: "0基行列索引" });
  app.get<{ Params: { fileId: string }; Querystring: WorkbookRead }>(
    "/api/v1/files/:fileId/workbook",
    {
      config,
      schema: {
        tags: ["外部AI表格"],
        summary: "读取工作表元数据或指定范围",
        description:
          "Bearer密钥实时权限验证；不传sheetId只返回工作表列表。指定0基闭区间读取值、公式和按需格式，每次最多2000格、512KiB；不返回历史。",
        params,
        querystring: Type.Unsafe<WorkbookRead>(
          workbookHttpSchema(workbookReadSchema),
        ),
        response: {
          200: Type.Object({
            fileId: id,
            revision,
            epoch,
            schemaVersion: Type.Integer({ description: "工作簿格式版本" }),
            sheets: Type.Array(
              Type.Object({
                sheetId,
                name: Type.String({ description: "工作表名称" }),
                rows: Type.Integer({ description: "工作表当前行数" }),
                columns: Type.Integer({ description: "工作表当前列数" }),
              }),
              { description: "密钥授权范围内的工作表列表" },
            ),
            range: Type.Optional(
              Type.Object(
                {
                  sheetId,
                  startRow: coordinate,
                  endRow: coordinate,
                  startColumn: coordinate,
                  endColumn: coordinate,
                  cells: Type.Array(
                    Type.Object({
                      row: coordinate,
                      column: coordinate,
                      value: Type.Unknown({
                        description: "单元格值或公式计算结果",
                      }),
                      formula: Type.Union([Type.String(), Type.Null()], {
                        description: "以=开头的公式，非公式单元格为空",
                      }),
                      format: Type.Optional(
                        Type.Record(Type.String(), Type.Unknown(), {
                          description: "按需返回的Fortune格式",
                        }),
                      ),
                    }),
                    { description: "按0基坐标返回的单元格列表" },
                  ),
                },
                { description: "指定工作表的0基闭区间读取结果" },
              ),
            ),
          }),
          ...errors,
          413: errors[400],
          429: errors[400],
        },
      },
    },
    (request) =>
      service.readWorkbook(
        token(request.headers.authorization),
        request.params.fileId,
        request.query,
      ),
  );
  app.patch<{ Params: { fileId: string }; Body: WorkbookUpdate }>(
    "/api/v1/files/:fileId/workbook",
    {
      config,
      schema: {
        tags: ["外部AI表格"],
        summary: "原子修改工作表范围或结构",
        description:
          "仅edit权限；先读取revision/epoch，再提交有requestId的批次。值与公式分离，未指定格式保留；行列、跨表引用与公式由权威引擎处理，成功提交AI历史后广播，不切换epoch。失败不部分写入。",
        params,
        body: Type.Unsafe<WorkbookUpdate>(
          workbookHttpSchema(workbookUpdateSchema),
        ),
        response: {
          200: Type.Object({
            ...checkpointSchema.properties,
            touchedSheetIds: Type.Array(sheetId, {
              description: "本次受影响的稳定工作表ID",
            }),
            touchedRanges: Type.Array(
              Type.Object({
                sheetId,
                startRow: coordinate,
                endRow: coordinate,
                startColumn: coordinate,
                endColumn: coordinate,
              }),
              {
                description:
                  "本次修改的0基单元格闭区间；结构修改另见touchedSheetIds",
              },
            ),
          }),
          ...errors,
          413: errors[400],
          429: errors[400],
        },
      },
    },
    (request) =>
      service.updateWorkbook(
        token(request.headers.authorization),
        request.params.fileId,
        request.body,
      ),
  );
  await registerAiFiles(app, service.files, token);
  return service;
}
