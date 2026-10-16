import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Transform, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { open, type ZipFile as ReadZip } from "yauzl";
import { ZipFile } from "yazl";
import type { TransferLimits } from "../../../../../config/file-transfer";
import { AppError } from "../../../../../system/server/src/errors";
import { invalidPackage, packagePath } from "./format";

export type ArchiveFile = { name: string; path: string; size: number };
const tooLarge = () =>
  new AppError(
    "TRANSFER_TOO_LARGE",
    "压缩包容量或条目数量超过限制，请缩小选择范围",
    413,
  );
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function counter(
  limit: number,
  signal?: AbortSignal,
  onChunk?: (chunk: Buffer) => void,
) {
  let count = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      count += chunk.length;
      if (signal?.aborted)
        return done(
          new AppError("TRANSFER_CANCELLED", "任务已取消或超时", 409),
        );
      if (count > limit) return done(tooLarge());
      try {
        onChunk?.(chunk);
        done(null, chunk);
      } catch (error) {
        done(error instanceof Error ? error : new Error("压缩包处理失败"));
      }
    },
  });
}
const openArchive = (path: string) =>
  new Promise<ReadZip>((resolve, reject) => {
    open(
      path,
      {
        lazyEntries: true,
        autoClose: false,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (error, zip) => (error ? reject(error) : resolve(zip)),
    );
  });

/** 将内容按序解压到随机路径；包内路径只作映射键，不进入服务器文件路径。 */
export async function readArchive(
  path: string,
  directory: string,
  limits: TransferLimits,
  signal?: AbortSignal,
): Promise<Map<string, ArchiveFile>> {
  if ((await stat(path)).size > limits.FILE_TRANSFER_MAX_BYTES)
    throw tooLarge();
  await mkdir(directory, { recursive: true });
  let zip: ReadZip | undefined;
  const result = new Map<string, ArchiveFile>();
  const names = new Set<string>();
  let expanded = 0;
  try {
    zip = await openArchive(path);
    if (zip.entryCount > limits.FILE_TRANSFER_MAX_ENTRIES) throw tooLarge();
    for await (const entry of zip.eachEntry()) {
      signal?.throwIfAborted();
      const directoryEntry = entry.fileName.endsWith("/");
      const name = packagePath(
        directoryEntry ? entry.fileName.slice(0, -1) : entry.fileName,
      );
      if (names.has(name)) throw invalidPackage("压缩包包含重复路径");
      names.add(name);
      if (
        names.size > limits.FILE_TRANSFER_MAX_ENTRIES ||
        name.split("/").length > limits.FILE_TRANSFER_MAX_DEPTH + 3
      )
        throw tooLarge();
      const type = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (
        entry.isEncrypted() ||
        !entry.canDecodeFileData() ||
        (type && type !== (directoryEntry ? 0x4000 : 0x8000))
      )
        throw invalidPackage("压缩包包含加密、链接或不支持的文件");
      if (
        !Number.isSafeInteger(entry.uncompressedSize) ||
        entry.uncompressedSize > limits.FILE_TRANSFER_EXPANDED_BYTES - expanded
      )
        throw tooLarge();
      if (directoryEntry) {
        if (entry.uncompressedSize) throw invalidPackage();
        continue;
      }
      const isContent = /\.(?:json|md)$/i.test(name);
      const maximum =
        name === "manifest.json"
          ? 16 * 1024 * 1024
          : isContent
            ? 8 * 1024 * 1024
            : limits.FILE_TRANSFER_MAX_BYTES;
      if (entry.uncompressedSize > maximum) throw tooLarge();
      const output = join(directory, crypto.randomUUID());
      let size = 0;
      let crc = 0xffffffff;
      const stream = await zip.openReadStreamPromise(entry);
      await pipeline(
        stream,
        counter(maximum, signal, (chunk) => {
          size += chunk.length;
          expanded += chunk.length;
          if (expanded > limits.FILE_TRANSFER_EXPANDED_BYTES) throw tooLarge();
          for (const byte of chunk)
            crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
        }),
        createWriteStream(output, { flags: "wx", mode: 0o600 }),
        { signal },
      );
      if (
        size !== entry.uncompressedSize ||
        (crc ^ 0xffffffff) >>> 0 !== entry.crc32
      )
        throw invalidPackage("压缩包内容校验失败");
      result.set(name, { name, path: output, size });
    }
    return result;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    if (error instanceof AppError) throw error;
    throw invalidPackage(signal?.aborted ? "任务已取消或超时" : undefined);
  } finally {
    zip?.close();
  }
}

/** 顺序读取磁盘源，限制最终输出大小；ZIP 打包不缓冲整个附件集合。 */
export async function writeArchive(
  files: { name: string; path: string }[],
  destination: string,
  limits: TransferLimits,
  signal?: AbortSignal,
  directories: string[] = [],
) {
  if (files.length + directories.length > limits.FILE_TRANSFER_MAX_ENTRIES)
    throw tooLarge();
  const zip = new ZipFile();
  const seen = new Set<string>();
  let expanded = 0;
  for (const file of files) {
    packagePath(file.name);
    if (seen.has(file.name)) throw invalidPackage("导出文件路径重复");
    seen.add(file.name);
    const size = (await stat(file.path)).size;
    expanded += size;
    if (
      size > limits.FILE_TRANSFER_MAX_BYTES ||
      expanded > limits.FILE_TRANSFER_EXPANDED_BYTES
    )
      throw tooLarge();
  }
  const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
  zip.on("error", (error) => output.destroy(error));
  const source = Readable.from(zip.outputStream);
  const writing = pipeline(
    source,
    counter(limits.FILE_TRANSFER_MAX_BYTES, signal),
    output,
    { signal },
  );
  // 每次只打开当前文件，yazl addFile 内部负责串行读取和关闭。
  for (const file of files)
    zip.addFile(file.path, file.name, { mode: 0o100600 });
  for (const name of directories) {
    packagePath(name);
    zip.addEmptyDirectory(name, { mode: 0o40700 });
  }
  zip.end();
  try {
    await writing;
  } catch (error) {
    source.destroy();
    await rm(destination, { force: true });
    throw error;
  }
}
export async function hashFile(path: string, signal?: AbortSignal) {
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { signal }))
    hash.update(chunk);
  return hash.digest("hex");
}
