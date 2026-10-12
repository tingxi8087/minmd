import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { and, eq, max, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as Y from "yjs";
import type { JSONContent } from "@tiptap/core";
import type { Database } from "../../../../../system/server/src/database/client";
import { AppError } from "../../../../../system/server/src/errors";
import {
  demoImports,
  type DemoImportResult,
} from "../../database/schema/demo-imports";
import { files } from "../../database/schema/files";
import { fileContents, fileVersions } from "../../database/schema/contents";
import { assets } from "../../database/schema/assets";
import { lockSpace, requireSpaceAccess } from "../spaces/service";
import { id } from "../spaces/schemas";
import { syncContentAssets } from "../assets/service";
import { pptxMime, validateAsset } from "../assets/validate";
import {
  createDocumentState,
  documentProjection,
} from "../collaboration/document-schema";
import * as S from "./schemas";

interface ImportOptions {
  assetStorageDir?: string;
  prepareSheet?: (projection: Record<string, unknown>) =>
    | {
        projection: Record<string, unknown>;
        engineState: Record<string, unknown>;
      }
    | Promise<{
        projection: Record<string, unknown>;
        engineState: Record<string, unknown>;
      }>;
}
const result = (job: typeof demoImports.$inferSelect) => ({
  jobId: job.id,
  status: job.results.every((item) => item.status === "success")
    ? ("completed" as const)
    : ("partial" as const),
  mapping: job.mapping,
  items: job.results,
});
function orderedEntries(entries: S.Entry[]) {
  const byId = new Map(entries.map((entry) => [entry.oldId, entry]));
  if (byId.size !== entries.length)
    throw new AppError("IMPORT_INVALID", "清单包含重复旧ID", 400);
  const ordered: S.Entry[] = [],
    visited = new Set<string>(),
    visiting = new Set<string>();
  const visit = (entry: S.Entry) => {
    if (visited.has(entry.oldId)) return;
    if (visiting.has(entry.oldId))
      throw new AppError("IMPORT_INVALID", "原目录包含循环父子关系", 400);
    visiting.add(entry.oldId);
    if (entry.parentOldId) {
      const parent = byId.get(entry.parentOldId);
      if (!parent || !["folder", "doc"].includes(parent.kind))
        throw new AppError(
          "IMPORT_INVALID",
          "原父文件缺失或类型不能容纳子文件",
          400,
        );
      visit(parent);
    }
    visiting.delete(entry.oldId);
    visited.add(entry.oldId);
    ordered.push(entry);
  };
  entries.forEach(visit);
  return ordered;
}
function migrateDocument(
  projection: Record<string, unknown>,
  mapping: Record<string, string>,
): JSONContent {
  const copy = structuredClone(projection);
  const visit = (value: unknown, depth: number) => {
    if (depth > 64)
      throw new AppError("CONTENT_INVALID", "原文档层级过深", 400);
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value))
      return value.forEach((child) => visit(child, depth + 1));
    const node = value as Record<string, unknown>;
    if (node.type === "link") {
      const attrs = node.attrs as Record<string, unknown> | undefined;
      const href = attrs?.href;
      // 只迁移应用自身的相对 Hash 路由；外站 URL 即使带相同片段也不属于本次清单。
      const match =
        typeof href === "string"
          ? /^(#\/(?:document|preview)\/)([^/?#]+)([?#].*)?$/.exec(href)
          : null;
      if (match) {
        let oldId: string | undefined;
        try {
          oldId = decodeURIComponent(match[2]!);
        } catch {
          // 不合法的编码保留原链接，不能阻止其余正文迁移。
        }
        if (oldId !== undefined && Object.hasOwn(mapping, oldId))
          attrs!.href = `${match[1]}${encodeURIComponent(mapping[oldId]!)}${match[3] ?? ""}`;
      }
    }
    if (node.type === "documentReference") {
      const attrs = node.attrs as Record<string, unknown> | undefined;
      const old = attrs?.id;
      if (typeof old !== "string" || !Object.hasOwn(mapping, old))
        throw new AppError(
          "IMPORT_REFERENCE_MISSING",
          "引用文件不在迁移清单中，请补齐清单或移除引用后重试",
          400,
        );
      attrs!.id = mapping[old];
    }
    if (node.type === "image") {
      const attrs = node.attrs as Record<string, unknown> | undefined;
      if (!attrs || typeof attrs.assetId !== "string")
        throw new AppError(
          "IMPORT_ASSET_MISSING",
          "文档图片尚未上传，请补充私有附件后重试",
          400,
        );
      attrs.src = `/api/app/assets/${attrs.assetId}`;
    }
    Object.values(node).forEach((child) => visit(child, depth + 1));
  };
  visit(copy, 0);
  return copy as JSONContent;
}

export async function registerDemoImports(
  app: FastifyInstance,
  database: Database,
  options: ImportOptions = {},
) {
  const params = Type.Object({ spaceId: id }, { additionalProperties: false });
  app.post<{ Params: { spaceId: string }; Body: S.ImportBody }>(
    "/api/app/spaces/:spaceId/demo-imports",
    {
      bodyLimit: 8 * 1024 * 1024,
      config: { auth: true, authScope: "app" },
      schema: {
        tags: ["演示数据迁移"],
        summary: "主动导入或重试本地演示文件",
        description:
          "仅当前空间成员可提交完整清单。同账号同空间幂等键复用映射，成功项不会覆盖，失败项可更正正文和附件重试。文件默认私有，不迁移账号、分享或密钥，不清理本地源数据。",
        params,
        body: S.body,
        response: { 200: S.response, ...S.errors, 413: S.errors[400] },
      },
    },
    async (request) => {
      const userId = request.appIdentity!.id,
        spaceId = request.params.spaceId;
      await requireSpaceAccess(database, userId, spaceId);
      const entries = orderedEntries(request.body.entries);
      const manifestHash = createHash("sha256")
        .update(
          JSON.stringify(
            entries
              .map(({ oldId, kind, name, parentOldId }) => ({
                oldId,
                kind,
                name,
                parentOldId: parentOldId ?? null,
              }))
              .sort((a, b) => a.oldId.localeCompare(b.oldId)),
          ),
        )
        .digest("hex");
      return database.db.transaction(async (tx) => {
        await lockSpace(tx, spaceId);
        await requireSpaceAccess(tx, userId, spaceId);
        const key = request.body.idempotencyKey;
        const [previous] = await tx
          .select()
          .from(demoImports)
          .where(
            and(
              eq(demoImports.userId, userId),
              eq(demoImports.spaceId, spaceId),
              eq(demoImports.idempotencyKey, key),
            ),
          )
          .for("update");
        if (previous && previous.manifestHash !== manifestHash)
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            "此幂等键对应另一份文件清单，请使用原完整清单重试",
            409,
          );
        const mapping =
          previous?.mapping ??
          Object.fromEntries(
            entries.map((entry) => [entry.oldId, crypto.randomUUID()]),
          );
        const results = new Map(
          (previous?.results ?? []).map((item) => [item.oldId, item]),
        );
        for (const entry of entries) {
          if (results.get(entry.oldId)?.status === "success") continue;
          const fileId = mapping[entry.oldId]!;
          try {
            await tx.transaction(async (itemTx) => {
              if (entry.missingAssets)
                throw new AppError(
                  "IMPORT_ASSET_MISSING",
                  "本地原文件缺失，请找回并上传附件后重试",
                  400,
                );
              const parentId = entry.parentOldId
                ? mapping[entry.parentOldId]!
                : null;
              if (
                entry.parentOldId &&
                results.get(entry.parentOldId)?.status !== "success"
              )
                throw new AppError(
                  "IMPORT_PARENT_FAILED",
                  "父文件尚未导入成功，请先修复父文件",
                  409,
                );
              if (parentId) {
                const [parent] = await itemTx
                  .select()
                  .from(files)
                  .where(eq(files.id, parentId));
                if (!parent || parent.deletedAt || parent.spaceId !== spaceId)
                  throw new AppError(
                    "IMPORT_PARENT_FAILED",
                    "目标父文件已移除，请恢复父文件后重试",
                    409,
                  );
              }
              const [last] = await itemTx
                .select({ position: max(files.position) })
                .from(files)
                .where(
                  and(
                    eq(files.spaceId, spaceId),
                    isNull(files.deletedAt),
                    parentId
                      ? eq(files.parentId, parentId)
                      : isNull(files.parentId),
                  ),
                );
              await itemTx.insert(files).values({
                id: fileId,
                spaceId,
                createdBy: userId,
                kind: entry.kind,
                name: entry.name,
                parentId,
                position: (last?.position ?? 0) + 1,
                visibility: "private",
              });
              if (entry.kind !== "folder") {
                let projection: Record<string, unknown>,
                  documentState: Buffer | null = null,
                  engineState: Record<string, unknown> | null = null;
                if (entry.kind === "doc") {
                  const doc = createDocumentState(
                    entry.projection
                      ? migrateDocument(entry.projection, mapping)
                      : undefined,
                  );
                  try {
                    projection = documentProjection(doc);
                    documentState = Buffer.from(Y.encodeStateAsUpdate(doc));
                  } finally {
                    doc.destroy();
                  }
                } else if (entry.kind === "slide") {
                  const assetId = entry.projection?.assetId;
                  if (
                    typeof assetId !== "string" ||
                    !/^[0-9a-f-]{36}$/i.test(assetId)
                  )
                    throw new AppError(
                      "IMPORT_ASSET_MISSING",
                      "PPTX原文件尚未上传，请补充附件后重试",
                      400,
                    );
                  const [asset] = await itemTx
                    .select()
                    .from(assets)
                    .where(
                      and(eq(assets.id, assetId), eq(assets.spaceId, spaceId)),
                    )
                    .for("share");
                  if (!asset || asset.mime !== pptxMime)
                    throw new AppError(
                      "ASSET_FORBIDDEN",
                      "PPTX附件无效或属于其他空间",
                      403,
                    );
                  if (!options.assetStorageDir)
                    throw new AppError(
                      "IMPORT_ASSET_UNAVAILABLE",
                      "附件存储未配置，请保留本地原文件",
                      400,
                    );
                  const binary = await readFile(
                    join(resolve(options.assetStorageDir), asset.storageKey),
                  ).catch(() => {
                    throw new AppError(
                      "ASSET_MISSING",
                      "PPTX原文件不存在，请重新上传后重试",
                      404,
                    );
                  });
                  const parsed = await validateAsset(
                    binary,
                    asset.filename,
                    asset.mime,
                  );
                  projection = {
                    assetId,
                    name: asset.filename,
                    size: asset.size,
                    slides: parsed.slides,
                  };
                } else {
                  if (!options.prepareSheet || !entry.projection)
                    throw new AppError(
                      "IMPORT_SHEET_UNAVAILABLE",
                      "表格迁移状态缺失或服务尚未配置，请保留本地数据",
                      400,
                    );
                  const prepared = await options.prepareSheet(entry.projection);
                  projection = prepared.projection;
                  engineState = prepared.engineState;
                }
                await itemTx.insert(fileContents).values({
                  fileId,
                  engine:
                    entry.kind === "doc"
                      ? "yjs"
                      : entry.kind === "sheet"
                        ? "fortune"
                        : "pptx",
                  projection,
                  documentState,
                  engineState,
                });
                await syncContentAssets(itemTx, fileId, projection);
                const [version] = await itemTx
                  .insert(fileVersions)
                  .values({
                    fileId,
                    revision: 1,
                    epoch: 1,
                    source: "initial",
                    actorId: userId,
                    note: "本地演示数据导入",
                    projection,
                    documentState,
                    engineState,
                  })
                  .returning();
                await syncContentAssets(
                  itemTx,
                  fileId,
                  projection,
                  version!.id,
                );
              }
            });
            results.set(entry.oldId, {
              oldId: entry.oldId,
              fileId,
              status: "success",
              message: "已导入为私有文件，原本地数据保留",
            });
          } catch (error) {
            const message =
              error instanceof AppError
                ? error.message
                : "导入失败，请稍后使用同一清单和幂等键重试";
            results.set(entry.oldId, {
              oldId: entry.oldId,
              fileId,
              status: "failed",
              message,
            });
          }
        }
        const values: DemoImportResult[] = request.body.entries.map((entry) =>
          results.get(entry.oldId)!,
        );
        const [job] = previous
          ? await tx
              .update(demoImports)
              .set({ results: values, updatedAt: new Date() })
              .where(eq(demoImports.id, previous.id))
              .returning()
          : await tx
              .insert(demoImports)
              .values({
                userId,
                spaceId,
                idempotencyKey: key,
                manifestHash,
                mapping,
                results: values,
              })
              .returning();
        return result(job!);
      });
    },
  );
  app.get<{ Params: { spaceId: string; jobId: string } }>(
    "/api/app/spaces/:spaceId/demo-imports/:jobId",
    {
      config: { auth: true, authScope: "app" },
      schema: {
        tags: ["演示数据迁移"],
        summary: "查询自己的迁移结果",
        description:
          "当前成员仅能读取自己在当前空间创建的任务，不泄露其他账号的旧ID及迁移结果。",
        params: Type.Object(
          { spaceId: id, jobId: id },
          { additionalProperties: false },
        ),
        response: { 200: S.response, ...S.errors },
      },
    },
    async (request) => {
      await requireSpaceAccess(
        database,
        request.appIdentity!.id,
        request.params.spaceId,
      );
      const [job] = await database.db
        .select()
        .from(demoImports)
        .where(
          and(
            eq(demoImports.id, request.params.jobId),
            eq(demoImports.spaceId, request.params.spaceId),
            eq(demoImports.userId, request.appIdentity!.id),
          ),
        );
      if (!job) throw new AppError("NOT_FOUND", "迁移任务不存在", 404);
      return result(job);
    },
  );
}
