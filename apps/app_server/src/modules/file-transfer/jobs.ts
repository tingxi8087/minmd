import { createWriteStream } from "node:fs";
import { mkdir, rm, readdir, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, eq, inArray } from "drizzle-orm";
import { assets } from "../../database/schema/assets";
import { AppError } from "../../../../../system/server/src/errors";
import { requireFileAccess } from "../files/service";
import { readArchive } from "./archive";
import { invalidPackage, parseManifest, type TransferManifest } from "./format";
import { buildExport, type ExportInput, type TransferServices } from "./export";
import {
  authorizeImport,
  commitPackage,
  importReceipt,
  type ImportInput,
} from "./import";
import { preparePackage, type PreparedPackage } from "./payload";

type Status =
  "waiting-upload" | "processing" | "ready" | "completed" | "failed";
export type TransferJob = {
  id: string;
  userId: string;
  spaceId: string;
  operation: "export" | "import";
  status: Status;
  processingMs?: number;
  done: number;
  total: number;
  createdAt: number;
  expiresAt: number;
  directory: string;
  controller: AbortController;
  promise?: Promise<void>;
  manifest?: TransferManifest;
  input?: ImportInput;
  prepared?: PreparedPackage;
  download?: string;
  downloadMime?: string;
  filename?: string;
  sourceIds?: string[];
  fileIds?: string[];
  error?: { code: string; message: string };
};
export function jobResponse(job: TransferJob) {
  return {
    id: job.id,
    operation: job.operation,
    status: job.status,
    done: job.done,
    total: job.total,
    expiresAt: new Date(job.expiresAt).toISOString(),
    filename: job.filename ?? null,
    mode: job.manifest?.mode ?? null,
    fileCount: job.manifest?.entries.length ?? 0,
    assetCount: job.manifest?.assets.length ?? 0,
    fileIds: job.fileIds ?? [],
    error: job.error ?? null,
  };
}
export class TransferJobs {
  readonly jobs = new Map<string, TransferJob>();
  private timer: ReturnType<typeof setInterval>;
  private closed = false;
  constructor(
    readonly services: TransferServices,
    readonly directory: string,
  ) {
    this.timer = setInterval(() => {
      void this.sweep().catch(() => {});
    }, 30000);
    this.timer.unref();
  }
  private async cleanupDirectory(directory: string) {
    const journal = Bun.file(join(directory, "pending-assets.json"));
    if (await journal.exists()) {
      if (
        journal.size >
        this.services.limits.FILE_TRANSFER_MAX_ENTRIES * 48 + 2
      )
        throw new Error("文件导入暂存恢复清单过大");
      const value: unknown = await journal.json();
      if (
        !Array.isArray(value) ||
        value.length > this.services.limits.FILE_TRANSFER_MAX_ENTRIES ||
        !value.every(
          (id) => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id),
        )
      )
        throw new Error("文件导入暂存恢复清单无效");
      const ids: string[] = value;
      const rows = ids.length
        ? await this.services.database.db
            .select({ id: assets.id })
            .from(assets)
            .where(inArray(assets.id, ids))
        : [];
      const retained = new Set(rows.map((row) => row.id));
      await Promise.all(
        ids
          .filter((id) => !retained.has(id))
          .map((id) =>
            unlink(join(this.services.assetDirectory, id)).catch(
              (error: NodeJS.ErrnoException) => {
                if (error.code !== "ENOENT") throw error;
              },
            ),
          ),
      );
    }
    // 数据库不可用时保留 journal，待下次恢复后判断文件是否已经提交。
    await rm(directory, { recursive: true, force: true });
  }
  async initialize() {
    let entries;
    try {
      entries = await readdir(this.directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && /^[0-9a-f-]{36}$/.test(entry.name))
        await this.cleanupDirectory(join(this.directory, entry.name));
    }
    await rmdir(this.directory).catch(() => {});
  }
  get(id: string, userId: string) {
    const job = this.jobs.get(id);
    if (!job || job.userId !== userId || job.expiresAt <= Date.now())
      throw new AppError(
        "TRANSFER_NOT_FOUND",
        "任务不存在或已过期，请重新提交",
        404,
      );
    return job;
  }
  private create(
    userId: string,
    spaceId: string,
    operation: "export" | "import",
    id: string = crypto.randomUUID(),
  ) {
    if (this.closed)
      throw new AppError("TRANSFER_UNAVAILABLE", "服务正在关闭", 503);
    const busy = [...this.jobs.values()].some(
      (job) =>
        job.userId === userId &&
        (job.promise ||
          ["waiting-upload", "processing"].includes(job.status) ||
          (job.operation === "import" && job.status === "ready")),
    );
    if (busy)
      throw new AppError(
        "TRANSFER_BUSY",
        "请先完成或取消当前导入导出任务",
        409,
      );
    if (this.jobs.has(id))
      throw new AppError(
        "TRANSFER_CONFLICT",
        "任务标识已使用，请重新提交",
        409,
      );
    const createdAt = Date.now();
    const job: TransferJob = {
      id,
      userId,
      spaceId,
      operation,
      status: operation === "import" ? "waiting-upload" : "processing",
      done: 0,
      total: 0,
      createdAt,
      expiresAt: createdAt + this.services.limits.FILE_TRANSFER_TTL_MS,
      directory: join(this.directory, id),
      controller: new AbortController(),
    };
    this.jobs.set(id, job);
    return job;
  }
  private run(
    job: TransferJob,
    action: (signal: AbortSignal) => Promise<void>,
  ) {
    if (job.promise)
      throw new AppError("TRANSFER_BUSY", "任务正在处理，请勿重复提交", 409);
    job.status = "processing";
    const started = Date.now();
    const remaining =
      this.services.limits.FILE_TRANSFER_TIMEOUT_MS - (job.processingMs ?? 0);
    if (remaining <= 0) job.controller.abort();
    const timer = setTimeout(
      () => job.controller.abort(),
      Math.max(0, remaining),
    );
    timer.unref();
    const running = Promise.resolve()
      .then(async () => {
        job.controller.signal.throwIfAborted();
        await mkdir(job.directory, { recursive: true });
        await action(job.controller.signal);
      })
      .catch(async (error: unknown) => {
        job.status = "failed";
        job.prepared = undefined;
        job.error =
          error instanceof AppError
            ? { code: error.code, message: error.message }
            : {
                code: "TRANSFER_FAILED",
                message: job.controller.signal.aborted
                  ? "任务已取消或超时，请重新提交"
                  : "文件处理失败，请检查文件或稍后重试",
              };
        await this.cleanupDirectory(job.directory).catch(() => {});
      })
      .finally(() => {
        clearTimeout(timer);
        job.processingMs = (job.processingMs ?? 0) + Date.now() - started;
        job.promise = undefined;
      });
    job.promise = running;
    return running;
  }
  async startExport(userId: string, spaceId: string, input: ExportInput) {
    await this.sweep();
    for (const previous of this.jobs.values())
      if (
        previous.userId === userId &&
        previous.operation === "export" &&
        previous.status === "ready" &&
        !previous.promise
      )
        await this.cancel(previous);
    const job = this.create(userId, spaceId, "export");
    void this.run(job, async (signal) => {
      const result = await buildExport(
        this.services,
        userId,
        spaceId,
        input,
        job.directory,
        signal,
        (done, total) => {
          job.done = done;
          job.total = total;
        },
      );
      signal.throwIfAborted();
      Object.assign(job, result);
      job.status = "ready";
      job.expiresAt = Date.now() + this.services.limits.FILE_TRANSFER_TTL_MS;
    });
    return job;
  }
  async startImport(
    userId: string,
    spaceId: string,
    id: string,
    input: ImportInput,
  ) {
    await this.sweep();
    const old = await importReceipt(this.services, userId, id);
    if (old) {
      if (old.spaceId !== spaceId || old.targetFileId !== input.replaceFileId)
        throw new AppError("TRANSFER_CONFLICT", "批次已用于其他导入目标", 409);
      await authorizeImport(this.services, userId, spaceId, input);
      return {
        id,
        operation: "import" as const,
        status: "completed" as const,
        done: old.fileIds.length,
        total: old.fileIds.length,
        expiresAt: new Date(
          Date.now() + this.services.limits.FILE_TRANSFER_TTL_MS,
        ).toISOString(),
        filename: null,
        mode: null,
        fileCount: old.fileIds.length,
        assetCount: 0,
        fileIds: old.fileIds,
        error: null,
      };
    }
    const existing = this.jobs.get(id);
    if (
      existing?.userId === userId &&
      existing.spaceId === spaceId &&
      existing.input?.parentId === input.parentId &&
      existing.input?.replaceFileId === input.replaceFileId &&
      existing.input?.expectedRevision === input.expectedRevision &&
      existing.input?.expectedEpoch === input.expectedEpoch
    )
      return jobResponse(this.get(id, userId));
    await authorizeImport(this.services, userId, spaceId, input);
    const job = this.create(userId, spaceId, "import", id);
    job.input = input;
    return jobResponse(job);
  }
  async upload(job: TransferJob, stream: Readable) {
    if (job.operation !== "import" || job.status !== "waiting-upload")
      throw new AppError("TRANSFER_CONFLICT", "任务当前不能上传文件", 409);
    await this.run(job, async (signal) => {
      let bytes = 0;
      const limit = this.services.limits.FILE_TRANSFER_MAX_BYTES;
      const count = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          bytes += chunk.length;
          done(
            bytes > limit
              ? new AppError(
                  "TRANSFER_TOO_LARGE",
                  "压缩包不能超过上传限制",
                  413,
                )
              : null,
            chunk,
          );
        },
      });
      const path = join(job.directory, "upload.zip");
      await pipeline(
        stream,
        count,
        createWriteStream(path, { flags: "wx", mode: 0o600 }),
        { signal },
      );
      const archive = await readArchive(
        path,
        join(job.directory, "extracted"),
        this.services.limits,
        signal,
      );
      const file = archive.get("manifest.json");
      if (!file) throw invalidPackage();
      let data: unknown;
      try {
        data = JSON.parse(await Bun.file(file.path).text());
      } catch {
        throw invalidPackage();
      }
      const manifest = parseManifest(data, this.services.limits);
      job.total = manifest.entries.length;
      job.prepared = await preparePackage(manifest, archive, signal);
      job.manifest = manifest;
      if (
        job.input!.replaceFileId &&
        (manifest.entries.length !== 1 || manifest.entries[0]!.kind !== "doc")
      )
        throw invalidPackage("此包包含多个文件，请通过文件列表上传入口导入");
      job.done = manifest.entries.length;
      job.status = "ready";
    });
    return jobResponse(job);
  }
  async commit(job: TransferJob) {
    if (job.status === "completed") return jobResponse(job);
    if (job.operation !== "import" || job.status !== "ready" || !job.prepared)
      throw new AppError("TRANSFER_CONFLICT", "请先上传并校验压缩包", 409);
    void this.run(job, async (signal) => {
      job.fileIds = await commitPackage(
        this.services,
        job.userId,
        job.spaceId,
        job.id,
        job.input!,
        job.prepared!,
        signal,
        job.directory,
      );
      job.status = "completed";
      job.prepared = undefined;
      await this.cleanupDirectory(job.directory);
    });
    return jobResponse(job);
  }
  async authorizeDownload(job: TransferJob) {
    if (job.operation !== "export" || job.status !== "ready" || !job.download)
      throw new AppError("TRANSFER_CONFLICT", "导出文件尚未就绪", 409);
    for (const id of job.sourceIds ?? [])
      await requireFileAccess(this.services.database, job.userId, id);
  }
  async cancel(job: TransferJob) {
    job.controller.abort();
    await job.promise;
    this.jobs.delete(job.id);
    await this.cleanupDirectory(job.directory);
  }
  async sweep() {
    for (const job of this.jobs.values())
      if (job.expiresAt <= Date.now()) await this.cancel(job);
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await Promise.allSettled(
      [...this.jobs.values()].map((job) => this.cancel(job)),
    );
    await rmdir(this.directory).catch(() => {});
  }
}
