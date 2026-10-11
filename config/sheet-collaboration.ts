import { z } from "zod";
const schema = z.object({
  SHEET_COLLAB_VERIFY_ENABLED: z.enum(["true", "false"]).default("false"),
  SHEET_COLLAB_MAX_SESSIONS: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10),
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
