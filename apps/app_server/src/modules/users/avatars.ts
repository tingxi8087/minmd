import type { FastifyInstance } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import { Type } from "@sinclair/typebox";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Database } from "../../../../../system/server/src/database/client";
import type { AppConfig } from "../../../../../system/server/src/config/env";
import { AppError } from "../../../../../system/server/src/errors";
import { writeAudit } from "../../../../../system/server/src/modules/audit/service";
import { validateAsset } from "../assets/validate";
import { errors } from "../spaces/schemas";
const mimeByExtension: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
export async function registerUserAvatars(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
  assetDirectory: string,
) {
  const directory = join(resolve(assetDirectory), "avatars");
  app.post<{ Body: { file: MultipartFile } }>(
    "/api/admin/app-users/avatar",
    {
      config: { auth: true, rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags: ["前台用户管理"],
        summary: "上传前台用户头像",
        description:
          "后台具备前台用户创建或编辑权限的管理员上传公开头像。仅允许1MB以内PNG/JPEG/WebP/GIF，返回站内地址；保存用户资料后生效。头像公开读取，不用于上传私有附件。",
        consumes: ["multipart/form-data"],
        body: Type.Object(
          {
            file: Type.Object(
              {
                type: Type.Literal("file", { description: "二进制文件字段" }),
                filename: Type.String({ description: "原文件名" }),
                mimetype: Type.String({
                  description: "声明的图片类型，需匹配实际内容",
                }),
              },
              { additionalProperties: true, description: "multipart图片对象" },
            ),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({
            url: Type.String({ description: "公开头像地址" }),
          }),
          ...errors,
          413: errors[413],
        },
      },
    },
    async (request) => {
      const identity = request.identity!;
      if (
        !identity.isSuperAdmin &&
        !identity.permissions.some((p) =>
          ["app-user:create", "app-user:update"].includes(p),
        )
      )
        throw new AppError("FORBIDDEN", "没有上传前台用户头像的权限", 403);
      const file = request.body.file;
      if (!file || file.type !== "file")
        throw new AppError("AVATAR_REQUIRED", "请选择头像图片", 400);
      if (!Object.values(mimeByExtension).includes(file.mimetype))
        throw new AppError(
          "AVATAR_INVALID",
          "头像仅支持PNG、JPEG、WebP或GIF图片",
          400,
        );
      const bytes = await file.toBuffer();
      const parsed = await validateAsset(bytes, "avatar", file.mimetype);
      const extension = Object.keys(mimeByExtension).find(
        (key) => mimeByExtension[key] === parsed.mime,
      )!;
      // 内容寻址让同一图片复用地址，替换头像不会覆盖浏览器缓存中的旧图片。
      const key = `${createHash("sha256").update(bytes).digest("hex")}.${extension}`;
      await mkdir(directory, { recursive: true });
      const temporary = join(directory, `${key}.${crypto.randomUUID()}.tmp`);
      try {
        await writeFile(temporary, bytes, { flag: "wx" });
        await rename(temporary, join(directory, key));
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
      await writeAudit(database.db, request, config.APP_ENV, {
        action: "app-user.avatar.upload",
        targetType: "avatar",
        targetId: key,
        result: "success",
        after: { mime: parsed.mime, size: bytes.length },
      });
      return { url: `/api/public/avatars/${key}` };
    },
  );
  app.get<{ Params: { key: string } }>(
    "/api/public/avatars/:key",
    {
      config: { auth: false },
      schema: {
        tags: ["前台用户管理"],
        summary: "读取公开头像",
        description: "匿名读取已上传头像；不开放空间附件或任意文件路径。",
        params: Type.Object(
          {
            key: Type.String({
              pattern: "^[a-f0-9]{64}\\.(png|jpg|webp|gif)$",
              description: "图片内容哈希及类型",
            }),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.String({ format: "binary", description: "公开头像二进制" }),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      const path = join(directory, request.params.key);
      try {
        await stat(path);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          throw new AppError("NOT_FOUND", "头像不存在", 404);
        throw error;
      }
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
      return reply
        .type(mimeByExtension[request.params.key.split(".")[1]!]!)
        .send(createReadStream(path));
    },
  );
}
