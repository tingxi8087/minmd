import { pruneFileVersions } from "../versions/retention";
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Database } from "../../../../../system/server/src/database/client";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import type { AppConfig } from "../../../../../system/server/src/config/env";
import { AppError } from "../../../../../system/server/src/errors";
import { loadMinmdConfig } from "../../../../../config/minmd";
import { fileContents, fileVersions } from "../../database/schema/contents";
import { assets } from "../../database/schema/assets";
import { requireFileAccess, lockFileSpace } from "../files/service";
import { id, errors } from "../spaces/schemas";
import { pptxMime, validateAsset } from "./validate";
import { requireAssetAccess, syncContentAssets } from "./service";

export async function registerPresentations(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
) {
  const settings = loadMinmdConfig(config);
  app.put<{
    Params: { fileId: string };
    Body: { assetId: string; expectedRevision: number; expectedEpoch: number };
  }>(
    "/api/app/files/:fileId/presentation",
    {
      config: { auth: true, authScope: "app" },
      schema: {
        tags: ["幻灯片"],
        summary: "绑定或替换PPTX原文件",
        description:
          "空间成员操作幻灯片文件，校验当前内容修订和同空间PPTX附件；新文件写入成功后才在事务中替换引用，旧历史附件继续保留。",
        params: Type.Object({ fileId: id }, { additionalProperties: false }),
        body: presentationBody,
        response: {
          200: presentationResponseSchema,
          ...errors,
        },
      },
    },
    (request) =>
      database.db.transaction((tx) =>
        bindPresentation(
          tx,
          settings.assetStorageDir,
          request.appIdentity!.id,
          request.params.fileId,
          request.body,
        ),
      ),
  );
}

export const presentationBody = Type.Object(
  {
    assetId: id,
    expectedRevision: Type.Integer({
      minimum: 1,
      description: "预期持久化修订",
    }),
    expectedEpoch: Type.Integer({ minimum: 1, description: "预期内容世代" }),
  },
  { additionalProperties: false },
);
export const presentationResponseSchema = Type.Object({
  fileId: id,
  revision: Type.Integer({ description: "新持久化修订" }),
  epoch: Type.Integer({ description: "新内容世代" }),
  projection: Type.Object(
    {
      assetId: id,
      name: Type.String({ description: "原文件名称" }),
      size: Type.Integer({ description: "原文件字节数" }),
      slides: Type.Integer({ description: "实际幻灯片数量" }),
    },
    { description: "只读幻灯片投影" },
  ),
});
/** 浏览器和API共享同一事务内绑定逻辑；调用方可在该事务保存成功幂等结果。 */
export async function bindPresentation(
  tx: Transaction,
  directory: string,
  userId: string,
  fileId: string,
  input: Static<typeof presentationBody>,
) {
  await lockFileSpace(tx, fileId);
  const file = await requireFileAccess(tx, userId, fileId, {
    permission: "edit",
  });
  if (file.kind !== "slide")
    throw new AppError("FILE_KIND_INVALID", "只有幻灯片可以绑定PPTX", 400);
  const [current] = await tx
    .select()
    .from(fileContents)
    .where(eq(fileContents.fileId, fileId))
    .for("update");
  if (
    !current ||
    current.revision !== input.expectedRevision ||
    current.epoch !== input.expectedEpoch
  )
    throw new AppError(
      "CONTENT_CONFLICT",
      "幻灯片内容已变化，请重新读取后替换",
      409,
      current
        ? { currentRevision: current.revision, currentEpoch: current.epoch }
        : undefined,
    );
  const [asset] = await tx
    .select()
    .from(assets)
    .where(eq(assets.id, input.assetId))
    .for("share");
  if (!asset || asset.spaceId !== file.spaceId || asset.mime !== pptxMime)
    throw new AppError(
      "ASSET_FORBIDDEN",
      "附件不存在、不是PPTX或属于其他空间",
      403,
    );
  if (!directory)
    throw new AppError("ASSET_STORAGE_UNAVAILABLE", "附件存储未配置", 503);
  const binary = await readFile(
    join(resolve(directory), asset.storageKey),
  ).catch(() => {
    throw new AppError("ASSET_MISSING", "PPTX原文件不存在", 404);
  });
  const parsed = await validateAsset(binary, asset.filename, asset.mime);
  const projection = {
    assetId: asset.id,
    name: asset.filename,
    size: asset.size,
    slides: parsed.slides,
  };
  if (current.projection.assetId === asset.id)
    return {
      fileId,
      revision: current.revision,
      epoch: current.epoch,
      projection,
    };
  const revision = current.revision + 1,
    epoch = current.epoch + 1;
  await requireAssetAccess(tx, userId, asset);
  await syncContentAssets(tx, fileId, projection, undefined, userId);
  await tx
    .update(fileContents)
    .set({
      projection,
      projectionRevision: revision,
      revision,
      epoch,
      updatedAt: new Date(),
    })
    .where(eq(fileContents.fileId, fileId));
  const [version] = await tx
    .insert(fileVersions)
    .values({
      fileId,
      revision,
      epoch,
      source: "import",
      actorId: userId,
      projection,
    })
    .returning({ id: fileVersions.id });
  await syncContentAssets(tx, fileId, projection, version!.id, userId);
  await pruneFileVersions(tx, fileId);
  return { fileId, revision, epoch, projection };
}
