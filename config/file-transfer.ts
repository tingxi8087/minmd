import { z } from "zod";
import { UPLOAD_MAX_BYTES } from "./uploads";

const integer = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
const schema = z.object({
  FILE_TRANSFER_MAX_BYTES: integer(UPLOAD_MAX_BYTES, 1024, UPLOAD_MAX_BYTES),
  FILE_TRANSFER_EXPANDED_BYTES: integer(1024 ** 3, 1024, 4 * 1024 ** 3),
  FILE_TRANSFER_MAX_FILES: integer(1000, 1, 10000),
  FILE_TRANSFER_MAX_ENTRIES: integer(5000, 1, 50000),
  FILE_TRANSFER_MAX_DEPTH: integer(32, 1, 64),
  FILE_TRANSFER_TIMEOUT_MS: integer(600000, 1000, 3600000),
  FILE_TRANSFER_TTL_MS: integer(1800000, 1000, 86400000),
});
/** 包容量与解压容量分开限制，不能信任 ZIP 中声明的原始尺寸。 */
export function fileTransferConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `Invalid configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  return parsed.data;
}
export type TransferLimits = ReturnType<typeof fileTransferConfig>;
