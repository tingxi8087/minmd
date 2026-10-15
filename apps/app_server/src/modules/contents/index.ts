import type { FastifyInstance } from "fastify";
import type { JSONContent } from "@tiptap/core";
import { eq } from "drizzle-orm";
import type { Database } from "../../../../../system/server/src/database/client";
import { AppError } from "../../../../../system/server/src/errors";
import { fileContents } from "../../database/schema/contents";
import { requireFileAccess } from "../files/service";
import type { SheetRooms } from "../collaboration/sheet-room";
import type { DocumentRooms } from "../collaboration/document-room";
import {
  params,
  errors,
  contentSchema,
  checkpointSchema,
  checkpointBody,
  replaceBody,
  type CheckpointBody,
  type ReplaceBody,
} from "./schemas";
export async function registerContents(
  app: FastifyInstance,
  database: Database,
  rooms: DocumentRooms,
  sheetRooms: SheetRooms,
) {
  const auth = { auth: true, authScope: "app" as const };
  const meta = (summary: string) => ({
    tags: ["文件正文"],
    summary,
    description:
      "仅空间成员访问；读取一致的服务端持久化投影，正文修订与文件元数据分开。",
  });
  app.get<{ Params: { fileId: string } }>(
    "/api/app/files/:fileId/content",
    {
      config: auth,
      schema: {
        ...meta("读取当前正文检查点"),
        params,
        response: { 200: contentSchema, ...errors },
      },
    },
    async (request) => {
      const file = await requireFileAccess(
        database,
        request.appIdentity!.id,
        request.params.fileId,
      );
      if (file.kind === "folder")
        throw new AppError("FILE_KIND_INVALID", "文件夹没有正文", 400);
      if (file.kind === "doc") await rooms.persistBarrier(file.id);
      if (file.kind === "sheet") await sheetRooms.persistBarrier(file.id);
      const [current] = await database.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, file.id));
      if (!current) throw new AppError("NOT_FOUND", "内容不存在", 404);
      if (current.projectionRevision !== current.revision)
        throw new AppError(
          "PROJECTION_PENDING",
          "内容投影尚未就绪，请稍后重试",
          409,
        );
      return {
        fileId: file.id,
        projection: current.projection,
        revision: current.revision,
        epoch: current.epoch,
        schemaVersion: current.schemaVersion,
        savedAt: current.updatedAt.toISOString(),
      };
    },
  );
  app.post<{ Params: { fileId: string }; Body: CheckpointBody }>(
    "/api/app/files/:fileId/checkpoint",
    {
      config: auth,
      schema: {
        ...meta("等待持久化并创建手动历史"),
        params,
        body: checkpointBody,
        response: { 200: checkpointSchema, ...errors },
      },
    },
    async (request) => {
      const userId = request.appIdentity!.id;
      const file = await requireFileAccess(
        database,
        userId,
        request.params.fileId,
        { permission: "edit" },
      );
      if (!["doc", "sheet"].includes(file.kind))
        throw new AppError("FILE_KIND_INVALID", "此文件只支持预览和下载", 400);
      if (file.kind === "sheet") {
        if (request.body.snapshot)
          throw new AppError("SNAPSHOT_INVALID", "表格不接收Yjs快照", 400);
        return sheetRooms.checkpoint(userId, file.id, request.body);
      }
      return rooms.checkpoint(userId, file.id, request.body);
    },
  );
  app.post<{ Params: { fileId: string }; Body: ReplaceBody }>(
    "/api/app/files/:fileId/content-import",
    {
      config: auth,
      schema: {
        ...meta("整体导入替换文档"),
        params,
        body: replaceBody,
        response: { 200: checkpointSchema, ...errors },
      },
    },
    async (request) => {
      const userId = request.appIdentity!.id;
      const file = await requireFileAccess(
        database,
        userId,
        request.params.fileId,
        { permission: "edit" },
      );
      if (!["doc", "sheet"].includes(file.kind))
        throw new AppError("FILE_KIND_INVALID", "此文件只支持预览和下载", 400);
      if (file.kind === "sheet")
        return sheetRooms.replaceWorkbook(file.id, userId, {
          ...request.body,
          source: "import",
        });
      return rooms.replaceDocument(file.id, userId, {
        ...request.body,
        projection: request.body.projection as JSONContent,
        source: "import",
      });
    },
  );
}
