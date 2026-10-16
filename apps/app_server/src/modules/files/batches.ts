import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { v5 as uuid } from "uuid";
import { fileTransferConfig } from "../../../../../config/file-transfer";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import { AppError } from "../../../../../system/server/src/errors";
import { files } from "../../database/schema/files";
import { fileContents } from "../../database/schema/contents";
import { lockSpace, requireSpaceAccess } from "../spaces/service";
import { captureExport, type TransferServices } from "../file-transfer/export";
import { cleanupTransferDirectory } from "../file-transfer/jobs";
import { preparePackage } from "../file-transfer/payload";
import { commitPackage, importReceipt } from "../file-transfer/import";
import type { ArchiveFile } from "../file-transfer/archive";
import { childrenOf, validateParent } from "./operations";
import { fileResponses, requireFileAccess } from "./service";
import { errors, fileSchema, nullableId, spaceParams } from "./schemas";
import { id } from "../spaces/schemas";

const fields = {
  fileIds: Type.Array(id, {
    minItems: 1,
    maxItems: 1000,
    uniqueItems: true,
    description: "选中文件 ID，包含子树，父子重复选择自动合并",
  }),
  parentId: nullableId,
};
const moveBody = Type.Object(fields, { additionalProperties: false });
const copyBody = Type.Object(
  {
    ...fields,
    requestId: Type.String({
      format: "uuid",
      description: "本次复制幂等编号，重试必须复用相同编号和参数",
    }),
  },
  { additionalProperties: false },
);
type MoveBody = Static<typeof moveBody>;
type CopyBody = Static<typeof copyBody>;
const response = {
  200: Type.Object({
    items: Type.Array(fileSchema, {
      description: "实际处理的根文件，重复后代不会再次返回",
    }),
    total: Type.Integer({ minimum: 0, description: "实际处理的根文件数量" }),
  }),
  ...errors,
};
const namespace = "8c57382c-0678-4cb3-bf5e-c04ef7174962";

/** 树修改共用空间锁；校验整棵源子树，不能借父目录越过受限子文件。 */
async function selection(
  tx: Transaction,
  userId: string,
  spaceId: string,
  body: MoveBody,
  permission: "read" | "manage",
  maxFiles: number,
) {
  await lockSpace(tx, spaceId);
  await requireSpaceAccess(tx, userId, spaceId);
  await validateParent(tx, spaceId, body.parentId);
  if (body.parentId)
    await requireFileAccess(tx, userId, body.parentId, { permission: "edit" });
  const rows = await tx
    .select()
    .from(files)
    .where(and(eq(files.spaceId, spaceId), isNull(files.deletedAt)))
    .orderBy(asc(files.position), asc(files.id));
  const chosen = new Set(body.fileIds);
  for (const fileId of chosen) {
    const file = rows.find((row) => row.id === fileId);
    if (!file)
      throw new AppError(
        "INVALID_SELECTION",
        "选中文件不存在、已删除或不在当前空间",
        409,
      );
  }
  const roots = rows.filter((row) => {
    if (!chosen.has(row.id)) return false;
    const visited = new Set<string>();
    let parent = row.parentId;
    while (parent && !visited.has(parent)) {
      if (chosen.has(parent)) return false;
      visited.add(parent);
      parent =
        rows.find((candidate) => candidate.id === parent)?.parentId ?? null;
    }
    return true;
  });
  const parent = rows.find((row) => row.id === body.parentId);
  if (parent?.kind === "doc" && roots.some((row) => row.kind !== "doc"))
    throw new AppError(
      "INVALID_PARENT",
      "文档下只能放置子文档，请选择文件夹或空间根目录",
      409,
    );
  const ids = new Set(roots.flatMap((root) => [...childrenOf(rows, root.id)]));
  if (ids.size > maxFiles)
    throw new AppError(
      "TRANSFER_TOO_LARGE",
      "选中文件及其后代超过批量操作数量限制",
      413,
    );
  if (body.parentId && ids.has(body.parentId))
    throw new AppError("TREE_CYCLE", "目标位置不能是选中文件自身或其后代", 409);
  for (const fileId of ids)
    await requireFileAccess(tx, userId, fileId, { permission });
  return { roots, ids, rows };
}

export async function registerFileBatches(
  app: FastifyInstance,
  input: Omit<TransferServices, "limits">,
) {
  const services = { ...input, limits: fileTransferConfig() };
  const database = input.database;
  const config = { auth: true, authScope: "app" as const };
  const meta = (summary: string, description: string) => ({
    tags: ["空间文件"],
    summary,
    description,
    params: spaceParams,
    response,
  });
  app.post<{ Params: { spaceId: string }; Body: MoveBody }>(
    "/api/app/spaces/:spaceId/files/batch-move",
    {
      config,
      schema: {
        ...meta(
          "批量移动文件",
          "仅空间成员可用；整批重新校验源子树管理权限和目标编辑权限，同空间事务内移动，保留内容、历史及分享授权；不允许自身或后代目标。",
        ),
        body: moveBody,
      },
    },
    async (request) =>
      database.db.transaction(async (tx) => {
        const userId = request.appIdentity!.id;
        const { roots, rows } = await selection(
          tx,
          userId,
          request.params.spaceId,
          request.body,
          "manage",
          services.limits.FILE_TRANSFER_MAX_FILES,
        );
        const rootIds = new Set(roots.map((row) => row.id));
        let position = Math.max(
          -1,
          ...rows
            .filter(
              (row) =>
                row.parentId === request.body.parentId && !rootIds.has(row.id),
            )
            .map((row) => row.position),
        );
        const updated = [];
        for (const file of roots) {
          const [row] = await tx
            .update(files)
            .set({
              parentId: request.body.parentId,
              position: ++position,
              metadataRevision: sql`${files.metadataRevision}+1`,
              updatedAt: new Date(),
            })
            .where(eq(files.id, file.id))
            .returning();
          updated.push(row!);
        }
        return {
          items: await fileResponses(tx, userId, updated),
          total: updated.length,
        };
      }),
  );
  const running = new Map<string, AbortController>();
  app.addHook("preClose", async () => {
    for (const controller of running.values()) controller.abort();
  });
  app.post<{ Params: { spaceId: string }; Body: CopyBody }>(
    "/api/app/spaces/:spaceId/files/batch-copy",
    {
      config,
      schema: {
        ...meta(
          "批量创建文件副本",
          "仅空间成员可用；读取完整源子树当前权威内容，在同空间目标目录原子创建私有副本及独立附件。当前账号为创建人，创建时间为当前时间，不复制原分享、收藏、历史；相同幂等编号与参数重试不会重复复制。",
        ),
        body: copyBody,
      },
    },
    async (request) => {
      const userId = request.appIdentity!.id,
        spaceId = request.params.spaceId;
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            "copy",
            userId,
            spaceId,
            [...new Set(request.body.fileIds)].sort(),
            request.body.parentId,
          ]),
        )
        .digest("hex");
      const batchId = uuid(`${userId}:${request.body.requestId}`, namespace);
      const result = async (fileIds: string[]) => {
        const rows = fileIds.length
          ? await database.db
              .select()
              .from(files)
              .where(inArray(files.id, fileIds))
          : [];
        const ids = new Set(fileIds);
        const roots = rows.filter(
          (row) => !row.parentId || !ids.has(row.parentId),
        );
        return {
          items: await fileResponses(database.db, userId, roots),
          total: roots.length,
        };
      };
      await requireSpaceAccess(database, userId, spaceId);
      const receipt = await importReceipt(services, userId, batchId);
      if (receipt) {
        if (
          receipt.requestFingerprint !== fingerprint ||
          receipt.spaceId !== spaceId
        )
          throw new AppError(
            "BATCH_CONFLICT",
            "操作编号已用于其他复制请求",
            409,
          );
        for (const fileId of request.body.fileIds) {
          const file = await requireFileAccess(database, userId, fileId, {
            deleted: true,
          });
          if (file.spaceId !== spaceId)
            throw new AppError("BATCH_CONFLICT", "复制源不在当前空间", 409);
        }
        return result(receipt.fileIds);
      }
      if (running.has(userId))
        throw new AppError(
          "BATCH_BUSY",
          "已有复制任务正在执行，请稍后重试",
          409,
        );
      const controller = new AbortController();
      running.set(userId, controller);
      const timer = setTimeout(
        () => controller.abort(),
        services.limits.FILE_TRANSFER_TIMEOUT_MS,
      );
      const directory = join(
        services.assetDirectory,
        ".file-transfers",
        crypto.randomUUID(),
      );
      try {
        const selected = await database.db.transaction((tx) =>
          selection(
            tx,
            userId,
            spaceId,
            request.body,
            "read",
            services.limits.FILE_TRANSFER_MAX_FILES,
          ),
        );
        await mkdir(directory, { recursive: true });
        const captured = await captureExport(
          services,
          userId,
          spaceId,
          {
            ids: selected.roots.map((row) => row.id),
            mode: "complete",
            single: false,
          },
          directory,
          controller.signal,
          () => {},
        );
        const archive = new Map<string, ArchiveFile>();
        for (const source of captured.sources)
          archive.set(source.name, {
            name: source.name,
            path: source.path,
            size: (await stat(source.path)).size,
          });
        const prepared = await preparePackage(
          captured.manifest,
          archive,
          controller.signal,
        );
        const fileIds = await commitPackage(
          services,
          userId,
          spaceId,
          batchId,
          { parentId: request.body.parentId, replaceFileId: null },
          prepared,
          controller.signal,
          directory,
          {
            copy: true,
            fingerprint,
            beforeCreate: async (tx) => {
              const current = await selection(
                tx,
                userId,
                spaceId,
                request.body,
                "read",
                services.limits.FILE_TRANSFER_MAX_FILES,
              );
              if (
                current.ids.size !== captured.rows.length ||
                captured.rows.some(
                  (row) =>
                    !current.ids.has(row.id) ||
                    current.rows.find((value) => value.id === row.id)
                      ?.metadataRevision !== row.metadataRevision,
                )
              )
                throw new AppError(
                  "BATCH_CONFLICT",
                  "源目录已变化，请重试复制",
                  409,
                );
              for (const [fileId, revision] of captured.revisions) {
                const [content] = await tx
                  .select()
                  .from(fileContents)
                  .where(eq(fileContents.fileId, fileId))
                  .for("share");
                if (
                  !content ||
                  content.revision !== revision.revision ||
                  content.epoch !== revision.epoch
                )
                  throw new AppError(
                    "BATCH_CONFLICT",
                    "源内容正在变化，请重试复制",
                    409,
                  );
              }
            },
          },
        );
        return result(fileIds);
      } finally {
        clearTimeout(timer);
        running.delete(userId);
        await cleanupTransferDirectory(services, directory);
      }
    },
  );
}
