import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import { join, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import { fileTransferConfig } from "../../../../../config/file-transfer";
import { AppError } from "../../../../../system/server/src/errors";
import { sendPrivateAsset } from "../assets/send";
import { requireSpaceAccess } from "../spaces/service";
import { requireFileAccess } from "../files/service";
import { TransferJobs, jobResponse } from "./jobs";
import { importReceipt } from "./import";
import type { TransferServices } from "./export";
import * as S from "./schemas";

export async function registerFileTransfers(
  app: FastifyInstance,
  services: Omit<TransferServices, "limits">,
) {
  const limits = fileTransferConfig();
  const jobs = new TransferJobs(
    { ...services, limits },
    join(resolve(services.assetDirectory), ".file-transfers"),
  );
  app.addHook("onReady", () => jobs.initialize());
  // 先中止上传流与后台任务，再等待 HTTP 连接关闭；否则慢上传会拖住停机。
  app.addHook("preClose", () => jobs.close());
  // 独立二进制解析器保留请求流，避免 multipart 默认将整个包缓冲到内存。
  app.addContentTypeParser("application/zip", (_request, stream, done) =>
    done(null, stream),
  );
  const config = { auth: true, authScope: "app" as const };
  const meta = (summary: string) => ({
    tags: ["文件导入导出"],
    summary,
    description:
      "仅已登录的前台用户操作本人任务；每次重新校验文件和空间权限，临时包不公开。导出包含选中目录当前内容及附件；导入全部新建或按修订替换单份文档，不迁移成员、分享权限和历史。",
  });
  const response = { 200: S.statusSchema, ...S.errors, 503: S.errors[400] };
  const receiptResponse = async (id: string, userId: string) => {
    const row = await importReceipt(jobs.services, userId, id);
    if (!row)
      throw new AppError("TRANSFER_NOT_FOUND", "任务不存在或已过期", 404);
    if (row.targetFileId)
      await requireFileAccess(services.database, userId, row.targetFileId, {
        permission: "edit",
      });
    else await requireSpaceAccess(services.database, userId, row.spaceId);
    return {
      id,
      operation: "import",
      status: "completed",
      done: row.fileIds.length,
      total: row.fileIds.length,
      expiresAt: new Date(
        Date.now() + limits.FILE_TRANSFER_TTL_MS,
      ).toISOString(),
      filename: null,
      mode: null,
      fileCount: row.fileIds.length,
      assetCount: 0,
      fileIds: row.fileIds,
      error: null,
    };
  };
  app.post<{ Params: { spaceId: string }; Body: S.ExportBody }>(
    "/api/app/spaces/:spaceId/file-exports",
    {
      config,
      schema: {
        ...meta("创建文件导出任务"),
        params: S.spaceParams,
        body: S.exportBody,
        response,
      },
    },
    async (request) =>
      jobResponse(
        await jobs.startExport(
          request.appIdentity!.id,
          request.params.spaceId,
          { ...request.body, single: request.body.single ?? false },
        ),
      ),
  );
  app.post<{ Params: { spaceId: string }; Body: S.ImportBody }>(
    "/api/app/spaces/:spaceId/file-imports",
    {
      config,
      schema: {
        ...meta("创建文件导入批次"),
        params: S.spaceParams,
        body: S.importBody,
        response,
      },
    },
    async (request) => {
      const { batchId, ...input } = request.body;
      return jobs.startImport(
        request.appIdentity!.id,
        request.params.spaceId,
        batchId,
        input,
      );
    },
  );
  app.get<{ Params: { transferId: string } }>(
    "/api/app/file-transfers/:transferId",
    {
      config,
      schema: {
        ...meta("读取本人导入导出进度"),
        params: S.transferParams,
        response,
      },
    },
    async (request) => {
      const { transferId } = request.params,
        userId = request.appIdentity!.id;
      if (!jobs.jobs.has(transferId))
        return receiptResponse(transferId, userId);
      return jobResponse(jobs.get(transferId, userId));
    },
  );
  app.put<{ Params: { transferId: string }; Body: Readable }>(
    "/api/app/file-transfers/:transferId/package",
    {
      config,
      bodyLimit: limits.FILE_TRANSFER_MAX_BYTES,
      schema: {
        ...meta("上传并校验导入包"),
        params: S.transferParams,
        consumes: ["application/zip"],
        // 原始流无法用 JSON 形状描述，实际字节、格式与容量由流式解析器检查。
        body: Type.Unsafe<Readable>({
          description:
            "原始 ZIP 二进制流，仅接受 application/zip；不是 JSON 请求体",
        }),
        response,
      },
    },
    async (request) => {
      if (
        request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !==
          "application/zip" ||
        !(request.body instanceof Readable)
      )
        throw new AppError("TRANSFER_INVALID", "请上传 ZIP 压缩包", 400);
      return jobs.upload(
        jobs.get(request.params.transferId, request.appIdentity!.id),
        request.body,
      );
    },
  );
  app.post<{ Params: { transferId: string }; Body: Record<string, never> }>(
    "/api/app/file-transfers/:transferId/commit",
    {
      config,
      schema: {
        ...meta("确认提交导入批次"),
        params: S.transferParams,
        body: S.empty,
        response,
      },
    },
    async (request) => {
      const { transferId } = request.params,
        userId = request.appIdentity!.id;
      if (!jobs.jobs.has(transferId))
        return receiptResponse(transferId, userId);
      return jobs.commit(jobs.get(transferId, userId));
    },
  );
  app.get<{ Params: { transferId: string } }>(
    "/api/app/file-transfers/:transferId/download",
    {
      config,
      schema: {
        ...meta("下载本人导出文件"),
        params: S.transferParams,
        response: {
          200: Type.String({
            format: "binary",
            description:
              "ZIP 压缩包或单文档 Markdown 文本；不包含服务端存储路径",
          }),
          ...S.errors,
        },
      },
    },
    async (request, reply) => {
      const job = jobs.get(request.params.transferId, request.appIdentity!.id);
      await jobs.authorizeDownload(job);
      return sendPrivateAsset(
        request,
        reply,
        job.download!,
        {
          filename: job.filename!,
          mime: job.downloadMime ?? "application/zip",
        },
        true,
      );
    },
  );
  app.delete<{ Params: { transferId: string } }>(
    "/api/app/file-transfers/:transferId",
    {
      config,
      schema: {
        ...meta("取消任务并清理临时包"),
        params: S.transferParams,
        response: {
          200: Type.Object(
            { ok: Type.Boolean({ description: "是否清理成功" }) },
            { description: "临时任务清理结果" },
          ),
          ...S.errors,
        },
      },
    },
    async (request) => {
      await jobs.cancel(
        jobs.get(request.params.transferId, request.appIdentity!.id),
      );
      return { ok: true };
    },
  );
  return jobs;
}
