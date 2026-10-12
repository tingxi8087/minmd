import type { FastifyInstance } from "fastify";
import type { JSONContent } from "@tiptap/core";
import { Type } from "@sinclair/typebox";
import { and, eq, desc, count } from "drizzle-orm";
import type { Database } from "../../../../../system/server/src/database/client";
import { AppError } from "../../../../../system/server/src/errors";
import { fileVersions } from "../../database/schema/contents";
import { requireFileAccess } from "../files/service";
import type { SheetRooms } from "../collaboration/sheet-room";
import type { DocumentRooms } from "../collaboration/document-room";
import { id, pagination, errors } from "../spaces/schemas";
import {
  projection,
  revision,
  epoch,
  checkpointSchema,
} from "../contents/schemas";
const versionSchema = Type.Object({
  id,
  fileId: id,
  revision,
  epoch,
  source: Type.String({
    description: "来源 initial/auto/manual/ai/import/restore/before-replace",
  }),
  actorId: Type.Union([id, Type.Null()], { description: "操作账号ID" }),
  note: Type.String({ description: "版本备注" }),
  createdAt: Type.String({ description: "版本创建时间" }),
});
const params = Type.Object({ fileId: id, versionId: id });
export function versionResponse(version: typeof fileVersions.$inferSelect) {
  return {
    id: version.id,
    fileId: version.fileId,
    revision: version.revision,
    epoch: version.epoch,
    source: version.source,
    actorId: version.actorId,
    note: version.note,
    createdAt: version.createdAt.toISOString(),
  };
}
export async function registerVersions(
  app: FastifyInstance,
  database: Database,
  rooms: DocumentRooms,
  sheetRooms: SheetRooms,
) {
  const auth = { auth: true, authScope: "app" as const };
  const meta = (summary: string) => ({
    tags: ["版本历史"],
    summary,
    description:
      "仅空间成员读取历史和修改备注，访客不可访问。版本预览返回隔离快照；恢复经协作适配层创建新世代，保留原历史。",
  });
  const getVersion = async (
    userId: string,
    fileId: string,
    versionId: string,
  ) => {
    await requireFileAccess(database, userId, fileId, { permission: "edit" });
    const [version] = await database.db
      .select()
      .from(fileVersions)
      .where(
        and(eq(fileVersions.fileId, fileId), eq(fileVersions.id, versionId)),
      );
    if (!version) throw new AppError("NOT_FOUND", "历史版本不存在", 404);
    return version;
  };
  app.get<{
    Params: { fileId: string };
    Querystring: { page?: number; pageSize?: number };
  }>(
    "/api/app/files/:fileId/versions",
    {
      config: auth,
      schema: {
        ...meta("列出版本历史"),
        params: Type.Object({ fileId: id }),
        querystring: pagination,
        response: {
          200: Type.Object({
            items: Type.Array(versionSchema, { description: "历史版本列表" }),
            total: Type.Integer({ description: "总条数" }),
            page: Type.Integer({ description: "当前页码" }),
            pageSize: Type.Integer({ description: "每页条数" }),
          }),
          ...errors,
        },
      },
    },
    async (request) => {
      await requireFileAccess(
        database,
        request.appIdentity!.id,
        request.params.fileId,
        { permission: "edit" },
      );
      const [result] = await database.db
        .select({ total: count() })
        .from(fileVersions)
        .where(eq(fileVersions.fileId, request.params.fileId));
      const total = result!.total,
        pageSize = request.query.pageSize ?? 50,
        page = Math.min(
          request.query.page ?? 1,
          Math.max(1, Math.ceil(total / pageSize)),
        );
      const items = await database.db
        .select()
        .from(fileVersions)
        .where(eq(fileVersions.fileId, request.params.fileId))
        .orderBy(
          desc(fileVersions.createdAt),
          desc(fileVersions.revision),
          fileVersions.id,
        )
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return { items: items.map(versionResponse), total, page, pageSize };
    },
  );
  app.get<{ Params: { fileId: string; versionId: string } }>(
    "/api/app/files/:fileId/versions/:versionId",
    {
      config: auth,
      schema: {
        ...meta("读取隔离版本预览"),
        params,
        response: {
          200: Type.Object({
            version: { ...versionSchema, description: "版本元数据" },
            projection,
          }),
          ...errors,
        },
      },
    },
    async (request) => {
      const version = await getVersion(
        request.appIdentity!.id,
        request.params.fileId,
        request.params.versionId,
      );
      return {
        version: versionResponse(version),
        projection: version.projection,
      };
    },
  );
  app.patch<{
    Params: { fileId: string; versionId: string };
    Body: { note: string };
  }>(
    "/api/app/files/:fileId/versions/:versionId",
    {
      config: auth,
      schema: {
        ...meta("修改手动版本备注"),
        params,
        body: Type.Object(
          { note: Type.String({ maxLength: 500, description: "版本备注" }) },
          { additionalProperties: false },
        ),
        response: { 200: versionSchema, ...errors },
      },
    },
    async (request) =>
      database.db.transaction(async (tx) => {
        await requireFileAccess(
          tx,
          request.appIdentity!.id,
          request.params.fileId,
          { permission: "edit" },
        );
        const [version] = await tx
          .select()
          .from(fileVersions)
          .where(
            and(
              eq(fileVersions.fileId, request.params.fileId),
              eq(fileVersions.id, request.params.versionId),
            ),
          )
          .for("update");
        if (!version) throw new AppError("NOT_FOUND", "版本不存在", 404);
        if (version.source !== "manual")
          throw new AppError(
            "VERSION_NOTE_INVALID",
            "仅手动版本可以修改备注",
            400,
          );
        const [saved] = await tx
          .update(fileVersions)
          .set({ note: request.body.note })
          .where(eq(fileVersions.id, version.id))
          .returning();
        return versionResponse(saved!);
      }),
  );
  app.post<{
    Params: { fileId: string; versionId: string };
    Body: { expectedRevision: number; expectedEpoch: number };
  }>(
    "/api/app/files/:fileId/versions/:versionId/restore",
    {
      config: auth,
      schema: {
        ...meta("恢复版本为新世代"),
        params,
        body: Type.Object(
          { expectedRevision: revision, expectedEpoch: epoch },
          { additionalProperties: false },
        ),
        response: { 200: checkpointSchema, ...errors },
      },
    },
    async (request) => {
      const version = await getVersion(
        request.appIdentity!.id,
        request.params.fileId,
        request.params.versionId,
      );
      const file = await requireFileAccess(
        database,
        request.appIdentity!.id,
        request.params.fileId,
        { permission: "edit" },
      );
      if (file.kind === "sheet")
        return sheetRooms.replaceWorkbook(file.id, request.appIdentity!.id, {
          ...request.body,
          projection: version.projection,
          source: "restore",
        });
      return rooms.replaceDocument(
        request.params.fileId,
        request.appIdentity!.id,
        {
          ...request.body,
          projection: version.projection as JSONContent,
          source: "restore",
        },
      );
    },
  );
}
