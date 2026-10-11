import { z } from "zod";
const schema = z.object({
  DOC_COLLAB_VERIFY_ENABLED: z.enum(["true", "false"]).default("false"),
  DOC_COLLAB_MAX_SESSIONS: z.coerce.number().int().min(1).max(100).default(10),
  DOC_COLLAB_VERIFY_DIR: z
    .string()
    .min(1)
    .default("runtime/document-verification"),
});
export function documentCollaborationConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const result = schema.safeParse(env);
  if (!result.success)
    throw Error(
      `文档协作配置无效：${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  return result.data;
}
