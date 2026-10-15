import { UPLOAD_MAX_BYTES } from "../../../../../config/uploads";
import JSZip from "jszip";
import { AppError } from "../../../../../system/server/src/errors";

export const pptxMime =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const invalid = () =>
  new AppError("ASSET_INVALID", "文件类型无效或文件已损坏", 400);
/** 先读取中央目录尺寸，阻止在解压前分配异常大的 OOXML 内容。 */
function validateZipDirectory(bytes: Buffer) {
  let end = -1;
  for (
    let at = bytes.length - 22;
    at >= Math.max(0, bytes.length - 65557);
    at--
  ) {
    if (
      bytes.readUInt32LE(at) === 0x06054b50 &&
      at + 22 + bytes.readUInt16LE(at + 20) === bytes.length
    ) {
      end = at;
      break;
    }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6))
    throw invalid();
  const entries = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const offset = bytes.readUInt32LE(end + 16);
  if (!entries || entries > 10000 || offset + directorySize > end)
    throw invalid();
  let at = offset;
  let expanded = 0;
  for (let index = 0; index < entries; index++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) throw invalid();
    const flags = bytes.readUInt16LE(at + 8);
    const size = bytes.readUInt32LE(at + 24);
    const length = bytes.readUInt16LE(at + 28);
    const next =
      at +
      46 +
      length +
      bytes.readUInt16LE(at + 30) +
      bytes.readUInt16LE(at + 32);
    const name = bytes.subarray(at + 46, at + 46 + length).toString("utf8");
    expanded += size;
    if (
      flags & 1 ||
      size === 0xffffffff ||
      expanded > 256 * 1024 * 1024 ||
      next > end ||
      /(^\/|\\|(^|\/)\.\.(\/|$))/.test(name)
    )
      throw invalid();
    at = next;
  }
  if (at !== offset + directorySize) throw invalid();
}
export async function validateAsset(
  bytes: Buffer,
  filename: string,
  suppliedMime: string,
) {
  if (!bytes.length) throw invalid();
  if (/\.pptx$/i.test(filename)) {
    if (bytes.length > UPLOAD_MAX_BYTES)
      throw new AppError("ASSET_TOO_LARGE", "PPTX 不能超过 200 MB", 413);
    if (
      ![pptxMime, "application/octet-stream", "application/zip"].includes(
        suppliedMime,
      )
    )
      throw invalid();
    validateZipDirectory(bytes);
    try {
      const zip = await JSZip.loadAsync(bytes);
      for (const name of [
        "[Content_Types].xml",
        "_rels/.rels",
        "ppt/presentation.xml",
      ]) {
        const file = zip.file(name);
        if (!file) throw invalid();
        const xml = await file.async("string");
        if (xml.length > 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml))
          throw invalid();
        if (
          name === "ppt/presentation.xml" &&
          !/<(?:\w+:)?presentation\b/.test(xml)
        )
          throw invalid();
        if (
          name === "[Content_Types].xml" &&
          !xml.includes("presentationml.presentation.main+xml")
        )
          throw invalid();
      }
      const slides = Object.keys(zip.files).filter((name) =>
        /^ppt\/slides\/slide\d+\.xml$/.test(name),
      ).length;
      if (!slides) throw invalid();
      return { mime: pptxMime, slides };
    } catch {
      throw invalid();
    }
  }
  if (bytes.length > 1024 * 1024)
    throw new AppError("ASSET_TOO_LARGE", "图片不能超过 1 MB", 413);
  const mime =
    bytes.length >= 24 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
      ? "image/png"
      : bytes.length >= 4 &&
          bytes[0] === 255 &&
          bytes[1] === 216 &&
          bytes[2] === 255
        ? "image/jpeg"
        : bytes.length >= 12 &&
            bytes.toString("ascii", 0, 4) === "RIFF" &&
            bytes.toString("ascii", 8, 12) === "WEBP"
          ? "image/webp"
          : bytes.length >= 13 &&
              ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))
            ? "image/gif"
            : undefined;
  if (!mime || suppliedMime !== mime) throw invalid();
  return { mime, slides: 0 };
}
