import { Type, type Static } from "@sinclair/typebox";
import type { MultipartFile } from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import type { Database } from "../../../../../system/server/src/database/client";
import { AppError } from "../../../../../system/server/src/errors";
import { id, errors } from "../spaces/schemas";
import { fileSchema } from "../files/schemas";
import { fileResponse } from "../files/service";
import { createFile } from "../files/operations";
import { requireSpaceAccess } from "../spaces/service";
import { fileContents, fileVersions } from "../../database/schema/contents";
import { storeAsset, syncContentAssets } from "./service";
const query = Type.Object(
  {
    parentId: Type.Optional(id),
    name: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 200,
        description: "显示名称，省略时使用原文件名",
      }),
    ),
  },
  { additionalProperties: false },
);
export function registerMedia(
  app: FastifyInstance,
  database: Database,
  directory: string,
) {
  app.post<{
    Params: { spaceId: string };
    Querystring: Static<typeof query>;
    Body: { file: MultipartFile };
  }>(
    "/api/app/spaces/:spaceId/media",
    {
      config: { auth: true, authScope: "app" },
      schema: {
        tags: ["私有附件"],
        summary: "上传PDF、视频或图片并创建预览文件",
        description:
          "空间成员上传 PDF（50MB）、图片（20MB）或MP4/WebM视频（200MB）。文件、正文与附件引用原子创建，失败不留下空文件；沿用空间及文件权限。",
        params: Type.Object({ spaceId: id }, { additionalProperties: false }),
        querystring: query,
        consumes: ["multipart/form-data"],
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
        response: { 200: fileSchema, ...errors, 413: errors[400] },
      },
    },
    async (request) => {
      const userId = request.appIdentity!.id,
        spaceId = request.params.spaceId;
      await requireSpaceAccess(database, userId, spaceId);
      const upload = request.body.file;
      if (!upload || upload.type !== "file")
        throw new AppError("ASSET_INVALID", "请选择上传文件", 400);
      let created: Awaited<ReturnType<typeof createFile>> | undefined;
      await storeAsset(
        database,
        directory,
        userId,
        spaceId,
        upload.filename,
        upload.mimetype,
        await upload.toBuffer(),
        {
          media: true,
          onCommitted: async (tx, asset) => {
            const kind =
              asset.mime === "application/pdf"
                ? "pdf"
                : asset.mime.startsWith("video/")
                  ? "video"
                  : "image";
            created = await createFile(tx, userId, spaceId, {
              kind,
              name: request.query.name?.trim() || asset.filename,
              parentId: request.query.parentId ?? null,
            });
            const projection = {
              assetId: asset.id,
              mime: asset.mime,
              name: asset.filename,
              size: asset.size,
            };
            await tx
              .insert(fileContents)
              .values({ fileId: created.id, engine: "asset", projection });
            await syncContentAssets(tx, created.id, projection);
            const [version] = await tx
              .insert(fileVersions)
              .values({
                fileId: created.id,
                revision: 1,
                epoch: 1,
                source: "initial",
                actorId: userId,
                projection,
              })
              .returning({ id: fileVersions.id });
            await syncContentAssets(tx, created.id, projection, version!.id);
          },
        },
      );
      return fileResponse(created!);
    },
  );
}
