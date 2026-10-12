import multipart, { type MultipartFile } from "@fastify/multipart";
import { Type } from "@sinclair/typebox";
import { eq } from "drizzle-orm";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Database } from "../../../../../system/server/src/database/client";
import type { AppConfig } from "../../../../../system/server/src/config/env";
import { AppError } from "../../../../../system/server/src/errors";
import { loadMinmdConfig } from "../../../../../config/minmd";
import { requireFileAccess } from "../files/service";
import { assets } from "../../database/schema/assets";
import { requireSpaceAccess } from "../spaces/service";
import { id, errors } from "../spaces/schemas";
import { requireAssetAccess, storeAsset, cleanUnboundAssets } from "./service";
import { registerPresentations } from "./presentation";

export const assetSchema = Type.Object({
  id,
  filename: Type.String({ description: "显示文件名" }),
  mime: Type.String({ description: "经实际内容检测的文件类型" }),
  size: Type.Integer({ description: "原文件字节数" }),
  slides: Type.Integer({ description: "PPTX幻灯片数量，图片为0" }),
  url: Type.String({ description: "成员鉴权读取地址" }),
});
export async function registerAssets(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
) {
  const settings = loadMinmdConfig(config);
  await registerPresentations(app, database, config);
  await app.register(multipart, {
    attachFieldsToBody: true,
    limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  });
  app.post<{ Params: { spaceId: string }; Body: { file: MultipartFile } }>(
    "/api/app/spaces/:spaceId/assets",
    {
      config: { auth: true, authScope: "app" },
      schema: {
        tags: ["私有附件"],
        summary: "上传空间附件",
        description:
          "空间成员上传PNG/JPEG/WebP/GIF（1MB）或PPTX（50MB）。文件体使用multipart的file字段，检测实际类型并存入私有目录，未绑定附件经过宽限期清理。",
        consumes: ["multipart/form-data"],
        params: Type.Object({ spaceId: id }, { additionalProperties: false }),
        body: Type.Object(
          {
            file: Type.Object(
              {
                type: Type.Literal("file", { description: "二进制文件字段" }),
                filename: Type.String({ description: "原文件名" }),
                mimetype: Type.String({
                  description: "客户端声明的MIME，必须匹配实际类型",
                }),
              },
              {
                additionalProperties: true,
                description: "multipart解析的文件对象",
              },
            ),
          },
          { additionalProperties: false },
        ),
        response: { 200: assetSchema, ...errors, 413: errors[400] },
      },
    },
    async (request) => {
      const file = request.body.file;
      if (!file || file.type !== "file")
        throw new AppError("ASSET_INVALID", "请选择上传文件", 400);
      return storeAsset(
        database,
        settings.assetStorageDir,
        request.appIdentity!.id,
        request.params.spaceId,
        file.filename,
        file.mimetype,
        await file.toBuffer(),
      );
    },
  );
  app.post<{ Params: { fileId: string }; Body: { file: MultipartFile } }>(
    "/api/app/files/:fileId/assets",
    {
      config: { auth: true, authScope: "app" },
      schema: {
        tags: ["私有附件"],
        summary: "向可编辑文件上传附件",
        description:
          "空间外指定编辑者也可调用；仅授权当前文件，上传和绑定在事务内重新验证文件编辑权限。",
        consumes: ["multipart/form-data"],
        params: Type.Object({ fileId: id }, { additionalProperties: false }),
        body: Type.Object(
          {
            file: Type.Object(
              {
                type: Type.Literal("file"),
                filename: Type.String(),
                mimetype: Type.String(),
              },
              { additionalProperties: true },
            ),
          },
          { additionalProperties: false },
        ),
        response: { 200: assetSchema, ...errors, 413: errors[400] },
      },
    },
    async (request) => {
      const file = await requireFileAccess(
        database,
        request.appIdentity!.id,
        request.params.fileId,
        { permission: "edit" },
      );
      if (file.kind === "folder")
        throw new AppError("FILE_KIND_INVALID", "文件夹不能插入附件", 400);
      const upload = request.body.file;
      if (!upload || upload.type !== "file")
        throw new AppError("ASSET_INVALID", "请选择上传文件", 400);
      return storeAsset(
        database,
        settings.assetStorageDir,
        request.appIdentity!.id,
        file.spaceId,
        upload.filename,
        upload.mimetype,
        await upload.toBuffer(),
        { fileId: file.id },
      );
    },
  );
  app.get<{ Params: { assetId: string }; Querystring: { download?: boolean } }>(
    "/api/app/assets/:assetId",
    {
      config: { auth: true, authScope: "app" },
      schema: {
        tags: ["私有附件"],
        summary: "读取私有附件",
        description:
          "重新检查当前账号与附件所属空间，返回原文件流。附件不通过公开静态目录提供，历史版本引用保留原文件。",
        params: Type.Object({ assetId: id }, { additionalProperties: false }),
        querystring: Type.Object(
          {
            download: Type.Optional(
              Type.Boolean({ description: "作为附件下载" }),
            ),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.String({
            format: "binary",
            description: "附件原始二进制内容",
          }),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      const [asset] = await database.db
        .select()
        .from(assets)
        .where(eq(assets.id, request.params.assetId));
      if (!asset) throw new AppError("NOT_FOUND", "附件不存在", 404);
      await requireAssetAccess(database, request.appIdentity!.id, asset);
      const path = join(resolve(settings.assetStorageDir), asset.storageKey);
      try {
        await stat(path);
      } catch {
        throw new AppError("ASSET_MISSING", "附件原文件暂不可用", 404);
      }
      reply
        .header("cache-control", "no-store")
        .header("x-content-type-options", "nosniff")
        .type(asset.mime);
      reply.header(
        "content-disposition",
        `${request.query.download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
      );
      return reply.send(createReadStream(path));
    },
  );
  const timer = setInterval(() => {
    void cleanUnboundAssets(
      database,
      settings.assetStorageDir,
      settings.assetGraceHours,
    );
  }, 3600000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
}
