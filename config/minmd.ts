import { z } from "zod";
import { resolve, relative, isAbsolute } from "node:path";
import type { AppConfig } from "../system/server/src/config/env";

const origin = z
  .string()
  .url()
  .refine((value) => new URL(value).origin === value);
const schema = z.object({
  AI_KEY_ENCRYPTION_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional(),
  ),
  AI_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(60),
  AI_EXECUTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(15000),
  ASSET_STORAGE_DIR: z.string().min(1).default("runtime/assets"),
  ASSET_UNBOUND_GRACE_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(720)
    .default(24),
  APP_REGISTRATION_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  APP_PUBLIC_ORIGIN: origin.optional(),
  APP_DEV_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .pipe(z.array(origin)),
});

/** 前台业务配置与后台来源分开，开发白名单不进入正式环境。 */
export function loadMinmdConfig(
  config: AppConfig,
  env: Record<string, string | undefined> = process.env,
) {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `Invalid configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  const primaryOrigin = parsed.data.APP_PUBLIC_ORIGIN ?? config.PUBLIC_ORIGIN;
  const assetDirectory = resolve(parsed.data.ASSET_STORAGE_DIR);
  for (const publicDirectory of [
    config.STATIC_DIR,
    config.WEB_CMS_DIST,
    config.WEB_DIST,
  ]) {
    const difference = relative(resolve(publicDirectory), assetDirectory);
    if (
      !difference ||
      (!difference.startsWith("..") && !isAbsolute(difference))
    ) {
      throw new Error(
        "Invalid configuration: ASSET_STORAGE_DIR must be outside static directories",
      );
    }
  }
  if (
    config.APP_ENV === "production" &&
    config.AUTH_TRANSPORT === "cookie" &&
    !config.HTTP_IP_DIRECT &&
    !primaryOrigin.startsWith("https://")
  ) {
    throw new Error(
      "Invalid configuration: APP_PUBLIC_ORIGIN must use HTTPS for production Cookie authentication",
    );
  }
  if (config.HTTP_IP_DIRECT && primaryOrigin !== config.PUBLIC_ORIGIN) {
    throw new Error(
      "Invalid configuration: APP_PUBLIC_ORIGIN must match PUBLIC_ORIGIN in HTTP_IP_DIRECT mode",
    );
  }
  return {
    aiKeyEncryptionKey: parsed.data.AI_KEY_ENCRYPTION_KEY,
    aiRequestsPerMinute: parsed.data.AI_REQUESTS_PER_MINUTE,
    aiExecutionTimeoutMs: parsed.data.AI_EXECUTION_TIMEOUT_MS,
    assetStorageDir: parsed.data.ASSET_STORAGE_DIR,
    assetGraceHours: parsed.data.ASSET_UNBOUND_GRACE_HOURS,
    registrationEnabled: parsed.data.APP_REGISTRATION_ENABLED,
    allowedOrigins: [
      primaryOrigin,
      ...(config.APP_ENV === "development" ? parsed.data.APP_DEV_ORIGINS : []),
    ],
  };
}
export type MinmdConfig = ReturnType<typeof loadMinmdConfig>;
export type MinmdAuthConfig = Pick<
  MinmdConfig,
  "registrationEnabled" | "allowedOrigins"
>;
