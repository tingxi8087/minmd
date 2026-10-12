import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { and, eq, sql } from "drizzle-orm";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Database } from "../../../../../system/server/src/database/client";
import type { AppConfig } from "../../../../../system/server/src/config/env";
import { AppError } from "../../../../../system/server/src/errors";
import {
  newToken,
  hashToken,
  hashValidatedPassword,
} from "../../../../../system/server/src/modules/auth/password";
import { loadMinmdConfig } from "../../../../../config/minmd";
import { files } from "../../database/schema/files";
import { fileShares, shareGuestSessions } from "../../database/schema/shares";
import { fileContents } from "../../database/schema/contents";
import { assets, fileAssets } from "../../database/schema/assets";
import { requireFileAccess } from "../files/service";
import { lockSpace } from "../spaces/service";
import { shareStatus, requirePublicShare, shareCookie } from "./service";
import {
  params,
  guestParams,
  token,
  body,
  shareStatus as statusSchema,
  shareResponse,
  publicResponse,
  ok,
  errors,
  type ShareBody,
} from "./schemas";
export interface ShareOptions {
  barrier?: (fileId: string, kind: string) => Promise<unknown>;
}
export async function registerShares(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
  options: ShareOptions = {},
) {
  const auth = { auth: true, authScope: "app" as const };
  const meta = (summary: string) => ({
    tags: ["文件分享"],
    summary,
    description:
      "仅空间成员设置单个文档、表格或PPT公开/私有分享，不继承父子目录权限。链接Token只在新建或重新生成时返回一次，密码只保存哈希。",
  });
  app.get<{ Params: { fileId: string } }>(
    "/api/app/files/:fileId/share",
    {
      config: auth,
      schema: {
        ...meta("查询分享配置"),
        params,
        response: { 200: statusSchema, ...errors },
      },
    },
    async (request) => {
      const file = await requireFileAccess(
        database,
        request.appIdentity!.id,
        request.params.fileId,
      );
      const [share] = await database.db
        .select()
        .from(fileShares)
        .where(eq(fileShares.fileId, file.id));
      return shareStatus(file, share);
    },
  );
  app.put<{ Params: { fileId: string }; Body: ShareBody }>(
    "/api/app/files/:fileId/share",
    {
      config: auth,
      schema: {
        ...meta("设置公开或私有分享"),
        params,
        body,
        response: { 200: shareResponse, ...errors },
      },
    },
    async (request) => {
      const passwordHash =
        typeof request.body.password === "string"
          ? await hashValidatedPassword(request.body.password)
          : undefined;
      return database.db.transaction(async (tx) => {
        const initial = await requireFileAccess(
          tx,
          request.appIdentity!.id,
          request.params.fileId,
        );
        await lockSpace(tx, initial.spaceId);
        const file = await requireFileAccess(
          tx,
          request.appIdentity!.id,
          initial.id,
        );
        if (file.kind === "folder")
          throw new AppError("FILE_KIND_INVALID", "文件夹不支持公开分享", 400);
        const [existing] = await tx
          .select()
          .from(fileShares)
          .where(eq(fileShares.fileId, file.id))
          .for("update");
        if (request.body.visibility === "private") {
          let revoked: typeof fileShares.$inferSelect | undefined;
          if (existing)
            [revoked] = await tx
              .update(fileShares)
              .set({
                revokedAt: new Date(),
                generation: existing.generation + 1,
                passwordHash: null,
                expiresAt: null,
                updatedAt: new Date(),
              })
              .where(eq(fileShares.id, existing.id))
              .returning();
          const [updated] = await tx
            .update(files)
            .set({
              visibility: "private",
              metadataRevision: sql`${files.metadataRevision}+1`,
              updatedAt: new Date(),
            })
            .where(eq(files.id, file.id))
            .returning();
          return shareStatus(updated!, revoked);
        }
        const expiresAt =
          request.body.expiresAt === undefined
            ? (existing?.expiresAt ?? null)
            : request.body.expiresAt === null
              ? null
              : new Date(request.body.expiresAt);
        if (expiresAt && expiresAt.getTime() <= Date.now())
          throw new AppError(
            "SHARE_EXPIRY_INVALID",
            "有效期必须晚于当前时间",
            400,
          );
        const rotate =
          !existing ||
          !!existing.revokedAt ||
          file.visibility !== "public" ||
          !!request.body.rotate;
        const plainToken = rotate ? newToken() : undefined;
        const generation = (existing?.generation ?? 0) + 1;
        const newPassword =
          request.body.password === null
            ? null
            : (passwordHash ?? existing?.passwordHash ?? null);
        const fields = {
          tokenHash: plainToken ? hashToken(plainToken) : existing!.tokenHash,
          passwordHash: newPassword,
          expiresAt,
          revokedAt: null,
          generation,
          updatedAt: new Date(),
        };
        const [saved] = existing
          ? await tx
              .update(fileShares)
              .set(fields)
              .where(eq(fileShares.id, existing.id))
              .returning()
          : await tx
              .insert(fileShares)
              .values({ ...fields, fileId: file.id })
              .returning();
        const [updated] = await tx
          .update(files)
          .set({
            visibility: "public",
            metadataRevision: sql`${files.metadataRevision}+1`,
            updatedAt: new Date(),
          })
          .where(eq(files.id, file.id))
          .returning();
        return {
          ...shareStatus(updated!, saved),
          ...(plainToken ? { token: plainToken } : {}),
        };
      });
    },
  );
  app.delete<{ Params: { fileId: string } }>(
    "/api/app/files/:fileId/share",
    {
      config: auth,
      schema: { ...meta("撤销分享并转为私有"), params, response: ok },
    },
    async (request) =>
      database.db.transaction(async (tx) => {
        const file = await requireFileAccess(
          tx,
          request.appIdentity!.id,
          request.params.fileId,
        );
        await lockSpace(tx, file.spaceId);
        await requireFileAccess(tx, request.appIdentity!.id, file.id);
        await tx
          .update(fileShares)
          .set({
            revokedAt: new Date(),
            passwordHash: null,
            generation: sql`${fileShares.generation}+1`,
            updatedAt: new Date(),
          })
          .where(eq(fileShares.fileId, file.id));
        await tx
          .update(files)
          .set({
            visibility: "private",
            metadataRevision: sql`${files.metadataRevision}+1`,
            updatedAt: new Date(),
          })
          .where(eq(files.id, file.id));
        return { ok: true };
      }),
  );
  const guestMeta = (summary: string) => ({
    tags: ["访客分享"],
    summary,
    description:
      "匿名只读单个有效公开分享；密码授权使用短期HttpOnly Cookie。逐次检查密码授权世代、到期、撤销及文件删除状态，不授予空间、文件树或历史访问权限。",
  });
  app.get<{ Params: { token: string } }>(
    "/api/public/shares/:token",
    {
      config: { auth: false, rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: {
        ...guestMeta("查询公开分享元数据与密码要求"),
        params: guestParams,
        response: {
          200: Type.Object({
            requiresPassword: Type.Boolean({
              description: "是否需要先验证密码",
            }),
            hasPassword: Type.Boolean({ description: "是否设置密码" }),
            expiresAt: statusSchema.properties.expiresAt,
            file: Type.Optional({
              ...publicResponse.properties.file,
              description: "获授权后可见的最小文件资料",
            }),
          }),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const row = await requirePublicShare(
        database.db,
        request.params.token,
        request.cookies,
        false,
      );
      let requiresPassword = false;
      try {
        await requirePublicShare(
          database.db,
          request.params.token,
          request.cookies,
        );
      } catch (error) {
        if (
          error instanceof AppError &&
          error.code === "SHARE_PASSWORD_REQUIRED"
        )
          requiresPassword = true;
        else throw error;
      }
      return {
        requiresPassword,
        hasPassword: !!row.share.passwordHash,
        expiresAt: row.share.expiresAt?.toISOString() ?? null,
        ...(!requiresPassword
          ? {
              file: {
                id: row.file.id,
                name: row.file.name,
                kind: row.file.kind,
              },
            }
          : {}),
      };
    },
  );
  app.get<{ Params: { token: string } }>(
    "/api/public/shares/:token/content",
    {
      config: { auth: false, rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: {
        ...guestMeta("读取当前公开内容"),
        params: guestParams,
        response: { 200: publicResponse, ...errors },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      let row = await requirePublicShare(
        database.db,
        request.params.token,
        request.cookies,
      );
      await options.barrier?.(row.file.id, row.file.kind);
      row = await requirePublicShare(
        database.db,
        request.params.token,
        request.cookies,
      );
      const [content] = await database.db
        .select()
        .from(fileContents)
        .where(eq(fileContents.fileId, row.file.id));
      if (!content) throw new AppError("NOT_FOUND", "分享内容不存在", 404);
      if (content.projectionRevision !== content.revision)
        throw new AppError(
          "PROJECTION_PENDING",
          "内容尚未同步完成，请稍后重试",
          409,
        );
      return {
        file: { id: row.file.id, name: row.file.name, kind: row.file.kind },
        content: {
          fileId: row.file.id,
          projection: content.projection,
          revision: content.revision,
          epoch: content.epoch,
          schemaVersion: content.schemaVersion,
          savedAt: content.updatedAt.toISOString(),
        },
      };
    },
  );
  app.post<{ Params: { token: string }; Body: { password: string } }>(
    "/api/public/shares/:token/unlock",
    {
      config: { auth: false, rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        ...guestMeta("验证分享密码"),
        params: guestParams,
        body: Type.Object(
          {
            password: Type.String({
              minLength: 1,
              maxLength: 128,
              description: "访问密码",
            }),
          },
          { additionalProperties: false },
        ),
        response: ok,
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (
        !loadMinmdConfig(config).allowedOrigins.includes(
          request.headers.origin ?? "",
        )
      )
        throw new AppError("CSRF_INVALID", "请求来源不合法", 403);
      const row = await requirePublicShare(
        database.db,
        request.params.token,
        request.cookies,
        false,
      );
      if (!row.share.passwordHash)
        throw new AppError("SHARE_PASSWORD_NOT_REQUIRED", "分享无需密码", 400);
      if (
        !(await Bun.password.verify(
          request.body.password,
          row.share.passwordHash,
        ))
      )
        throw new AppError("SHARE_PASSWORD_INVALID", "分享密码错误", 403);
      const guestToken = newToken(),
        expiresAt = new Date(
          Math.min(
            Date.now() + 3600000,
            row.share.expiresAt?.getTime() ?? Infinity,
          ),
        );
      await database.db.transaction(async (tx) => {
        const current = await requirePublicShare(
          tx,
          request.params.token,
          {},
          false,
        );
        if (current.share.generation !== row.share.generation)
          throw new AppError(
            "SHARE_CHANGED",
            "分享配置已变化，请重新验证",
            409,
          );
        await tx.insert(shareGuestSessions).values({
          shareId: row.share.id,
          generation: row.share.generation,
          tokenHash: hashToken(guestToken),
          expiresAt,
        });
      });
      reply.setCookie(shareCookie(row.share.id), guestToken, {
        httpOnly: true,
        secure: config.APP_ENV === "production",
        sameSite: "strict",
        path: `/api/public/shares/${request.params.token}`,
        expires: expiresAt,
      });
      return { ok: true };
    },
  );
  app.get<{
    Params: { token: string; assetId: string };
    Querystring: { download?: boolean };
  }>(
    "/api/public/shares/:token/assets/:assetId",
    {
      config: { auth: false, rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: {
        ...guestMeta("读取分享当前正文引用的附件"),
        params: Type.Object({ token, assetId: params.properties.fileId }),
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
            description: "当前正文实际引用的附件原文件",
          }),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      let row = await requirePublicShare(
        database.db,
        request.params.token,
        request.cookies,
      );
      await options.barrier?.(row.file.id, row.file.kind);
      row = await requirePublicShare(
        database.db,
        request.params.token,
        request.cookies,
      );
      const [asset] = await database.db
        .select({ asset: assets })
        .from(fileAssets)
        .innerJoin(assets, eq(assets.id, fileAssets.assetId))
        .where(
          and(
            eq(fileAssets.fileId, row.file.id),
            eq(fileAssets.assetId, request.params.assetId),
            eq(assets.spaceId, row.file.spaceId),
          ),
        );
      if (!asset)
        throw new AppError("ASSET_FORBIDDEN", "附件未被当前分享文件引用", 403);
      const path = join(
        resolve(loadMinmdConfig(config).assetStorageDir),
        asset.asset.storageKey,
      );
      try {
        await stat(path);
      } catch {
        throw new AppError("ASSET_MISSING", "附件原文件暂不可用", 404);
      }
      reply
        .type(asset.asset.mime)
        .header("x-content-type-options", "nosniff")
        .header(
          "content-disposition",
          `${request.query.download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(asset.asset.filename)}`,
        );
      return reply.send(createReadStream(path));
    },
  );
}
