import { AppError } from "../../../../../system/server/src/errors";
import { UPLOAD_MAX_BYTES } from "../../../../../config/uploads";
export const MEDIA_MAX_BYTES = UPLOAD_MAX_BYTES;
export function validateMediaAsset(
  bytes: Buffer,
  filename: string,
  suppliedMime: string,
) {
  const invalid = () =>
    new AppError(
      "ASSET_INVALID",
      "文件格式与实际内容不匹配，仅支持 PDF、PNG/JPEG/WebP/GIF、MP4/WebM",
      400,
    );
  let mime: string, kind: "pdf" | "image" | "video";
  if (/\.pdf$/i.test(filename) && bytes.subarray(0, 5).toString() === "%PDF-") {
    mime = "application/pdf";
    kind = "pdf";
  } else if (
    /\.png$/i.test(filename) &&
    bytes.length >= 24 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  ) {
    mime = "image/png";
    kind = "image";
  } else if (
    /\.jpe?g$/i.test(filename) &&
    bytes.length >= 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  ) {
    mime = "image/jpeg";
    kind = "image";
  } else if (
    /\.webp$/i.test(filename) &&
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    mime = "image/webp";
    kind = "image";
  } else if (
    /\.gif$/i.test(filename) &&
    bytes.length >= 13 &&
    ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))
  ) {
    mime = "image/gif";
    kind = "image";
  } else if (
    /\.mp4$/i.test(filename) &&
    bytes.length >= 16 &&
    bytes.toString("ascii", 4, 8) === "ftyp" &&
    /^(isom|iso[2-9]|mp4[12]|avc1|M4V |dash)/.test(
      bytes.toString("ascii", 8, 12),
    )
  ) {
    mime = "video/mp4";
    kind = "video";
  } else if (
    /\.webm$/i.test(filename) &&
    bytes.length >= 16 &&
    bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
    bytes.subarray(0, 4096).includes(Buffer.from("webm"))
  ) {
    mime = "video/webm";
    kind = "video";
  } else throw invalid();
  if (
    suppliedMime &&
    ![mime, "application/octet-stream"].includes(suppliedMime)
  )
    throw invalid();
  const limit = UPLOAD_MAX_BYTES;
  if (bytes.length > limit)
    throw new AppError(
      "ASSET_TOO_LARGE",
      `${kind === "video" ? "视频" : kind === "pdf" ? "PDF" : "图片"}不能超过 ${limit / 1024 / 1024} MB`,
      413,
    );
  return { mime, kind, slides: 0 };
}
