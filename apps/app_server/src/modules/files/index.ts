import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import {
  and,
  eq,
  isNull,
  isNotNull,
  count,
  asc,
  desc,
  ilike,
  sql,
  inArray,
} from "drizzle-orm";
import type { Database } from "../../../../../system/server/src/database/client";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import { AppError } from "../../../../../system/server/src/errors";
import { files, fileFavorites, fileVisits } from "../../database/schema/files";
import {
  requireSpaceAccess,
  requireSpaceOwner,
  lockSpace,
} from "../spaces/service";
import { requireFileAccess, fileResponse, fileResponses } from "./service";
import {
  childrenOf,
  createFile,
  renameFile,
  moveFile,
  deleteFile,
  restoreFile,
} from "./operations";
import {
  fileSchema,
  fileParams,
  spaceParams,
  createBody,
  patchBody,
  moveBody,
  restoreBody,
  query,
  empty,
  errors,
  ok,
  listSchema,
  type CreateBody,
  type PatchBody,
  type MoveBody,
  type RestoreBody,
  type FilesQuery,
} from "./schemas";
export { requireFileAccess } from "./service";
type File = typeof files.$inferSelect;
export interface FileOptions {
  onCreated?: (tx: Transaction, file: File) => Promise<void>;
  onDeleted?: (fileIds: string[]) => Promise<void>;
  onPurge?: (tx: Transaction, fileIds: string[]) => Promise<void>;
}
export async function assertSpaceEmpty(tx: Transaction, spaceId: string) {
  const [item] = await tx
    .select({ id: files.id })
    .from(files)
    .where(eq(files.spaceId, spaceId))
    .limit(1);
  if (item)
    throw new AppError(
      "SPACE_NOT_EMPTY",
      "空间内仍有文件，请先清理文件与回收站",
      409,
    );
}
export async function registerFiles(
  app: FastifyInstance,
  database: Database,
  options: FileOptions = {},
) {
  const auth = { auth: true, authScope: "app" as const };
  const meta = (summary: string) => ({
    tags: ["空间文件"],
    summary,
    description:
      "当前前台账号须是文件所属空间成员；文件树修改在空间事务锁内重新校验授权和父子关系。",
  });
  const mutate = async <T>(
    userId: string,
    fileId: string,
    operation: (tx: Transaction, file: File) => Promise<T>,
    deleted = false,
  ) =>
    database.db.transaction(async (tx) => {
      const first = await requireFileAccess(tx, userId, fileId, { deleted });
      await lockSpace(tx, first.spaceId);
      const file = await requireFileAccess(tx, userId, fileId, { deleted });
      return operation(tx, file);
    });
  const parentCondition = (parentId: string | null) =>
    parentId ? eq(files.parentId, parentId) : isNull(files.parentId);
  app.get<{ Params: { spaceId: string }; Querystring: FilesQuery }>(
    "/api/app/spaces/:spaceId/files",
    {
      config: auth,
      schema: {
        ...meta("分页查询文件"),
        params: spaceParams,
        querystring: query,
        response: { 200: listSchema, ...errors },
      },
    },
    async (request) => {
      const userId = request.appIdentity!.id;
      const spaceId = request.params.spaceId;
      const q = request.query;
      await requireSpaceAccess(database, userId, spaceId);
      const conditions = [
        eq(files.spaceId, spaceId),
        q.scope === "trash"
          ? isNotNull(files.deletedAt)
          : isNull(files.deletedAt),
      ];
      if (q.parentId)
        conditions.push(
          parentCondition(q.parentId === "root" ? null : q.parentId),
        );
      if (q.kind) conditions.push(eq(files.kind, q.kind));
      if (q.q)
        conditions.push(
          ilike(files.name, `%${q.q.replace(/[\\%_]/g, "\\$&")}%`),
        );
      if (q.scope === "favorites")
        conditions.push(
          inArray(
            files.id,
            database.db
              .select({ id: fileFavorites.fileId })
              .from(fileFavorites)
              .where(eq(fileFavorites.userId, userId)),
          ),
        );
      if (q.scope === "recent")
        conditions.push(
          inArray(
            files.id,
            database.db
              .select({ id: fileVisits.fileId })
              .from(fileVisits)
              .where(eq(fileVisits.userId, userId)),
          ),
        );
      const condition = and(...conditions);
      const [result] = await database.db
        .select({ total: count() })
        .from(files)
        .where(condition);
      const total = result!.total;
      const pageSize = q.pageSize ?? 50;
      const page = Math.min(
        q.page ?? 1,
        Math.max(1, Math.ceil(total / pageSize)),
      );
      const order =
        q.scope === "recent"
          ? desc(
              sql`(select visited_at from file_visits where file_id=${files.id} and user_id=${userId})`,
            )
          : asc(files.position);
      const items = await database.db
        .select()
        .from(files)
        .where(condition)
        .orderBy(order, files.createdAt, files.id)
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return {
        items: await fileResponses(database.db, request.appIdentity!.id, items),
        total,
        page,
        pageSize,
      };
    },
  );
  app.get<{ Params: { spaceId: string }; Querystring: { parentId?: string } }>(
    "/api/app/spaces/:spaceId/tree",
    {
      config: auth,
      schema: {
        ...meta("读取文件树元数据"),
        params: spaceParams,
        querystring: Type.Object(
          { parentId: query.properties.parentId },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            items: Type.Array(fileSchema, { description: "有效文件树节点" }),
          }),
          ...errors,
        },
      },
    },
    async (request) => {
      await requireSpaceAccess(
        database,
        request.appIdentity!.id,
        request.params.spaceId,
      );
      const items = await database.db
        .select()
        .from(files)
        .where(
          and(
            eq(files.spaceId, request.params.spaceId),
            isNull(files.deletedAt),
            request.query.parentId
              ? parentCondition(
                  request.query.parentId === "root"
                    ? null
                    : request.query.parentId,
                )
              : undefined,
          ),
        )
        .orderBy(files.position, files.createdAt, files.id);
      return {
        items: await fileResponses(database.db, request.appIdentity!.id, items),
      };
    },
  );
  app.get<{ Params: { fileId: string } }>(
    "/api/app/files/:fileId",
    {
      config: auth,
      schema: {
        ...meta("读取文件资料"),
        params: fileParams,
        response: { 200: fileSchema, ...errors },
      },
    },
    async (request) =>
      (
        await fileResponses(database.db, request.appIdentity!.id, [
          await requireFileAccess(
            database,
            request.appIdentity!.id,
            request.params.fileId,
          ),
        ])
      )[0]!,
  );
  app.post<{ Params: { spaceId: string }; Body: CreateBody }>(
    "/api/app/spaces/:spaceId/files",
    {
      config: auth,
      schema: {
        ...meta("创建文件或文件夹"),
        params: spaceParams,
        body: createBody,
        response: { 200: fileSchema, ...errors },
      },
    },
    async (request) => {
      if (["pdf", "video", "image"].includes(request.body.kind))
        throw new AppError(
          "FILE_KIND_INVALID",
          "请通过上传文件创建预览文件",
          400,
        );
      return database.db.transaction(async (tx) =>
        fileResponse(
          await createFile(
            tx,
            request.appIdentity!.id,
            request.params.spaceId,
            request.body,
            options.onCreated,
          ),
        ),
      );
    },
  );
  app.patch<{ Params: { fileId: string }; Body: PatchBody }>(
    "/api/app/files/:fileId",
    {
      config: auth,
      schema: {
        ...meta("重命名文件"),
        params: fileParams,
        body: patchBody,
        response: { 200: fileSchema, ...errors },
      },
    },
    async (request) =>
      database.db.transaction(
        async (tx) =>
          (
            await fileResponses(tx, request.appIdentity!.id, [
              await renameFile(
                tx,
                request.appIdentity!.id,
                request.params.fileId,
                request.body,
              ),
            ])
          )[0]!,
      ),
  );
  app.post<{ Params: { fileId: string }; Body: MoveBody }>(
    "/api/app/files/:fileId/move",
    {
      config: auth,
      schema: {
        ...meta("移动文件与调整同级顺序"),
        params: fileParams,
        body: moveBody,
        response: { 200: fileSchema, ...errors },
      },
    },
    async (request) =>
      database.db.transaction(
        async (tx) =>
          (
            await fileResponses(tx, request.appIdentity!.id, [
              await moveFile(
                tx,
                request.appIdentity!.id,
                request.params.fileId,
                request.body,
              ),
            ])
          )[0]!,
      ),
  );
  app.delete<{ Params: { fileId: string } }>(
    "/api/app/files/:fileId",
    {
      config: auth,
      schema: {
        ...meta("删除文件及有效后代到回收站"),
        params: fileParams,
        response: ok,
      },
    },
    async (request) => {
      const deleted = await database.db.transaction((tx) =>
        deleteFile(tx, request.appIdentity!.id, request.params.fileId),
      );
      await options.onDeleted?.(deleted);
      return { ok: true };
    },
  );
  app.post<{ Params: { fileId: string }; Body: RestoreBody }>(
    "/api/app/files/:fileId/restore",
    {
      config: auth,
      schema: {
        ...meta("按删除批次恢复文件"),
        params: fileParams,
        body: restoreBody,
        response: { 200: fileSchema, ...errors },
      },
    },
    async (request) =>
      database.db.transaction(
        async (tx) =>
          (
            await fileResponses(tx, request.appIdentity!.id, [
              await restoreFile(
                tx,
                request.appIdentity!.id,
                request.params.fileId,
                request.body,
              ),
            ])
          )[0]!,
      ),
  );
  app.post<{ Params: { fileId: string }; Body: { confirm: true } }>(
    "/api/app/files/:fileId/purge",
    {
      config: auth,
      schema: {
        ...meta("负责人永久删除回收站文件"),
        params: fileParams,
        body: Type.Object(
          { confirm: Type.Literal(true, { description: "明确确认永久删除" }) },
          { additionalProperties: false },
        ),
        response: ok,
      },
    },
    async (request) =>
      mutate(
        request.appIdentity!.id,
        request.params.fileId,
        async (tx, file) => {
          await requireSpaceOwner(tx, request.appIdentity!.id, file.spaceId);
          if (!file.deletedAt)
            throw new AppError(
              "FILE_NOT_DELETED",
              "只能永久删除回收站文件",
              409,
            );
          const rows = await tx
            .select()
            .from(files)
            .where(eq(files.spaceId, file.spaceId));
          const ids = childrenOf(rows, file.id);
          const subtree = rows.filter((row) => ids.has(row.id));
          if (subtree.some((row) => !row.deletedAt))
            throw new AppError(
              "ACTIVE_CHILD",
              "目录内存在有效文件，不能永久删除",
              409,
            );
          await options.onPurge?.(tx, [...ids]);
          // 自引用外键为 restrict，叶节点先删除，避免绕过目录与批次约束。
          const remaining = new Set(ids);
          while (remaining.size) {
            const leaves = subtree.filter(
              (row) =>
                remaining.has(row.id) &&
                !subtree.some(
                  (child) =>
                    child.parentId === row.id && remaining.has(child.id),
                ),
            );
            if (!leaves.length)
              throw new AppError("TREE_CYCLE", "文件树结构异常", 409);
            const leafIds = leaves.map((row) => row.id);
            await tx.delete(files).where(inArray(files.id, leafIds));
            for (const id of leafIds) remaining.delete(id);
          }
          return { ok: true };
        },
        true,
      ),
  );
  app.put<{ Params: { fileId: string }; Body: Record<string, never> }>(
    "/api/app/files/:fileId/favorite",
    {
      config: auth,
      schema: {
        ...meta("收藏文件"),
        params: fileParams,
        body: empty,
        response: ok,
      },
    },
    async (request) =>
      mutate(
        request.appIdentity!.id,
        request.params.fileId,
        async (tx, file) => {
          await tx
            .insert(fileFavorites)
            .values({ userId: request.appIdentity!.id, fileId: file.id })
            .onConflictDoNothing();
          return { ok: true };
        },
      ),
  );
  app.delete<{ Params: { fileId: string } }>(
    "/api/app/files/:fileId/favorite",
    {
      config: auth,
      schema: { ...meta("取消收藏文件"), params: fileParams, response: ok },
    },
    async (request) =>
      mutate(
        request.appIdentity!.id,
        request.params.fileId,
        async (tx, file) => {
          await tx
            .delete(fileFavorites)
            .where(
              and(
                eq(fileFavorites.userId, request.appIdentity!.id),
                eq(fileFavorites.fileId, file.id),
              ),
            );
          return { ok: true };
        },
      ),
  );
  app.post<{ Params: { fileId: string }; Body: Record<string, never> }>(
    "/api/app/files/:fileId/visit",
    {
      config: auth,
      schema: {
        ...meta("记录当前账号访问时间"),
        params: fileParams,
        body: empty,
        response: ok,
      },
    },
    async (request) =>
      mutate(
        request.appIdentity!.id,
        request.params.fileId,
        async (tx, file) => {
          await tx
            .insert(fileVisits)
            .values({ userId: request.appIdentity!.id, fileId: file.id })
            .onConflictDoUpdate({
              target: [fileVisits.userId, fileVisits.fileId],
              set: { visitedAt: new Date() },
            });
          return { ok: true };
        },
      ),
  );
}
