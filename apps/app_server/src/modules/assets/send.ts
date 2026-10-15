import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../../../../../system/server/src/errors";

export function byteRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !size) return null;
  let start: number, end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    return null;
  return { start, end: Math.min(end, size - 1) };
}
/** 必须在调用方完成文件/分享权限检查之后使用；每个 Range 请求都会重新鉴权。 */
export async function sendPrivateAsset(
  request: FastifyRequest,
  reply: FastifyReply,
  path: string,
  asset: { mime: string; filename: string },
  download = false,
) {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    throw new AppError("ASSET_MISSING", "附件原文件暂不可用", 404);
  }
  reply
    .header("cache-control", "no-store")
    .header("x-content-type-options", "nosniff")
    .header("accept-ranges", "bytes")
    .type(asset.mime)
    .header(
      "content-disposition",
      `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
    );
  const header = request.headers.range;
  if (header && !request.headers["if-range"]) {
    const range = byteRange(header, size);
    if (!range) {
      reply.header("content-range", `bytes */${size}`);
      throw new AppError("RANGE_INVALID", "请求的文件范围无效", 416);
    }
    reply
      .code(206)
      .header("content-range", `bytes ${range.start}-${range.end}/${size}`)
      .header("content-length", range.end - range.start + 1);
    return reply.send(createReadStream(path, range));
  }
  reply.header("content-length", size);
  return reply.send(createReadStream(path));
}
