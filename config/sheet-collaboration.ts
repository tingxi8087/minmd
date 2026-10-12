import { z } from "zod";
const schema = z.object({
  SHEET_COLLAB_VERIFY_ENABLED: z.enum(["true", "false"]).default("false"),
  SHEET_COLLAB_MAX_SESSIONS: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10),
  SHEET_COLLAB_REVISION_WINDOW: z.coerce
    .number()
    .int()
    .min(16)
    .max(4096)
    .default(256),
  SHEET_COLLAB_UNDO_WINDOW: z.coerce
    .number()
    .int()
    .min(1)
    .max(4096)
    .default(256),
  SHEET_COLLAB_HISTORY_WINDOW: z.coerce
    .number()
    .int()
    .min(4096)
    .max(65536)
    .default(4096),
  SHEET_COLLAB_MAX_MESSAGE_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(8 * 1024 * 1024)
    .default(8 * 1024 * 1024),
  SHEET_COLLAB_MAX_CONTENT_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(8 * 1024 * 1024)
    .default(8 * 1024 * 1024),
  SHEET_COLLAB_MESSAGES_PER_SECOND: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100),
  SHEET_COLLAB_VERIFY_DIR: z
    .string()
    .min(1)
    .default("runtime/sheet-verification"),
});
export function sheetCollaborationConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `表格协作配置无效：${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  return result.data;
}
