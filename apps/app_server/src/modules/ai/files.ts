import { aiErrors as errors } from "./schemas";
import { Type, type Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import { AppError } from "../../../../../system/server/src/errors";
import { id } from "../spaces/schemas";
import {
  fileSchema,
  createBody,
  patchBody,
  moveBody,
  restoreBody,
  revision,
} from "../files/schemas";
import { assetSchema } from "../assets";
import {
  presentationBody,
  presentationResponseSchema,
} from "../assets/presentation";
import type { AiFileService } from "./files-service";
export const requestId = Type.String({
  minLength: 8,
  maxLength: 100,
  pattern: "^[A-Za-z0-9_-]+$",
  description: "密钥范围内唯一请求ID，相同请求重试返回原结果",
});
const create = Type.Object(
  { ...createBody.properties, requestId },
  { additionalProperties: false },
);
const rename = Type.Object(
  { ...patchBody.properties, requestId },
  { additionalProperties: false },
);
const move = Type.Object(
  { ...moveBody.properties, requestId },
  { additionalProperties: false },
);
const restore = Type.Object(
  { ...restoreBody.properties, expectedMetadataRevision: revision, requestId },
  { additionalProperties: false },
);
const remove = Type.Object(
  { expectedMetadataRevision: revision, requestId },
  { additionalProperties: false },
);
export async function registerAiFiles(
  app: FastifyInstance,
  service: AiFileService,
  token: (header?: string) => string,
) {
  const config = {
    auth: false,
    rateLimit: { max: 60, timeWindow: "1 minute" },
  };
  const params = Type.Object({ fileId: id }, { additionalProperties: false });
  const presentation = Type.Object(
    { ...presentationBody.properties, requestId },
    { additionalProperties: false },
  );
  app.put<{ Params: { fileId: string }; Body: Static<typeof presentation> }>(
    "/api/v1/files/:fileId/presentation",
    {
      config,
      schema: {
        tags: ["外部AI文件"],
        summary: "绑定或替换已上传PPTX",
        description:
          "edit授权API密钥只能绑定同空间真实PPTX附件，上传另需upload权限。按照expectedRevision/expectedEpoch检查并保留历史原文件；同事务保存幂等结果，超时或失败回滚。只接收附件ID，不通过此接口传二进制。",
        params,
        body: presentation,
        response: { 200: presentationResponseSchema, ...errors },
      },
    },
    (request) =>
      service.bindPresentation(
        token(request.headers.authorization),
        request.params.fileId,
        request.body,
      ),
  );
  app.get<{ Params: { fileId: string } }>(
    "/api/v1/files/:fileId",
    {
      config,
      schema: {
        tags: ["外部AI文件"],
        summary: "读取文件与回收站资料",
        description:
          "read授权密钥只读取绑定空间的单文件元数据，包括删除状态和metadataRevision；不返回正文、历史和分享凭证。",
        params,
        response: { 200: fileSchema, ...errors },
      },
    },
    (request) =>
      service.readMetadata(
        token(request.headers.authorization),
        request.params.fileId,
      ),
  );
  const meta = (summary: string, scope: string) => ({
    tags: ["外部AI文件"],
    summary,
    description: `显式Bearer API密钥须取得密钥的${scope}授权，只操作密钥绑定空间。同事务复验授权并保存幂等结果；不开放空间、成员、分享和永久删除权限。`,
  });
  app.post<{ Body: Static<typeof create> }>(
    "/api/v1/files",
    {
      config,
      schema: {
        ...meta("创建文件或文件夹", "create"),
        body: create,
        response: { 200: fileSchema, ...errors },
      },
    },
    (request) =>
      service.create(token(request.headers.authorization), request.body),
  );
  app.patch<{ Params: { fileId: string }; Body: Static<typeof rename> }>(
    "/api/v1/files/:fileId",
    {
      config,
      schema: {
        ...meta("重命名文件", "organize"),
        params,
        body: rename,
        response: { 200: fileSchema, ...errors },
      },
    },
    (request) =>
      service.rename(
        token(request.headers.authorization),
        request.params.fileId,
        request.body,
      ),
  );
  app.post<{ Params: { fileId: string }; Body: Static<typeof move> }>(
    "/api/v1/files/:fileId/move",
    {
      config,
      schema: {
        ...meta("移动与排序文件", "organize"),
        params,
        body: move,
        response: { 200: fileSchema, ...errors },
      },
    },
    (request) =>
      service.move(
        token(request.headers.authorization),
        request.params.fileId,
        request.body,
      ),
  );
  app.post<{ Params: { fileId: string }; Body: Static<typeof remove> }>(
    "/api/v1/files/:fileId/delete",
    {
      config,
      schema: {
        ...meta("移入回收站并关闭相关协作连接", "delete_restore"),
        params,
        body: remove,
        response: {
          200: Type.Object({
            ok: Type.Boolean({ description: "已成功删除到回收站" }),
            deletedIds: Type.Array(id, {
              description: "本次删除的有效后代文件ID",
            }),
          }),
          ...errors,
        },
      },
    },
    (request) =>
      service.delete(
        token(request.headers.authorization),
        request.params.fileId,
        request.body,
      ),
  );
  app.post<{ Params: { fileId: string }; Body: Static<typeof restore> }>(
    "/api/v1/files/:fileId/restore",
    {
      config,
      schema: {
        ...meta("恢复同一删除批次", "delete_restore"),
        params,
        body: restore,
        response: { 200: fileSchema, ...errors },
      },
    },
    (request) =>
      service.restore(
        token(request.headers.authorization),
        request.params.fileId,
        request.body,
      ),
  );
  app.post<{
    Headers: { "x-request-id": string };
    Body: { file: MultipartFile };
  }>(
    "/api/v1/assets",
    {
      config,
      schema: {
        ...meta("上传私有附件", "upload"),
        consumes: ["multipart/form-data"],
        headers: Type.Object(
          { "x-request-id": requestId },
          { additionalProperties: true },
        ),
        body: Type.Object(
          {
            file: Type.Object(
              {
                type: Type.Literal("file", { description: "二进制文件字段" }),
                filename: Type.String({ description: "原文件名" }),
                mimetype: Type.String({
                  description: "声明MIME须匹配实际内容",
                }),
              },
              {
                additionalProperties: true,
                description: "multipart文件对象，仅允许单文件",
              },
            ),
          },
          { additionalProperties: false },
        ),
        response: { 200: assetSchema, ...errors, 413: errors[400] },
      },
    },
    async (request) => {
      const secret = token(request.headers.authorization);
      const file = request.body.file;
      if (!file || file.type !== "file")
        throw new AppError("ASSET_INVALID", "请选择上传文件", 400);
      return service.upload(secret, {
        requestId: request.headers["x-request-id"],
        filename: file.filename,
        mime: file.mimetype,
        bytes: await file.toBuffer(),
      });
    },
  );
}
