import { z } from "zod";
import { isIP } from "node:net";
import { webCmsPath } from "./web-cms-path";

const schema = z.object({
  APP_ENV: z
    .enum(["development", "staging", "production"])
    .default("development"),
  API_DEBUG_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(9811),
  HTTP_BODY_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .min(1048576)
    .max(67108864)
    .default(16777216),
  TRUST_PROXY_ADDRESSES: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    )
    .pipe(
      z.array(
        z.string().refine((value) => {
          const [address, prefix, extra] = value.split("/");
          const family = isIP(address ?? "");
          return (
            family !== 0 &&
            extra === undefined &&
            (prefix === undefined ||
              (/^\d+$/.test(prefix) &&
                Number(prefix) >= 0 &&
                Number(prefix) <= (family === 4 ? 32 : 128)))
          );
        }, "Explicit proxy IP or CIDR required"),
      ),
    ),
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (value) => /^postgres(ql)?:/.test(value),
      "PostgreSQL URL required",
    ),
  ADMIN_ACCOUNT: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  AUTH_TRANSPORT: z.enum(["bearer", "cookie"]).default("bearer"),
  HTTP_IP_DIRECT: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AUTH_TOKEN_STORAGE: z
    .enum(["memory", "sessionStorage", "localStorage"])
    .default("sessionStorage"),
  AUTH_SESSION_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  PUBLIC_ORIGIN: z
    .string()
    .url()
    .default("http://127.0.0.1:9811")
    .refine((value) => new URL(value).origin === value, "Origin only"),
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    )
    .refine(
      (values) =>
        values.every((value) => {
          try {
            return new URL(value).origin === value;
          } catch {
            return false;
          }
        }),
      "Explicit origins required",
    ),
  LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
  WEB_CMS_DIST: z.string().min(1).default("dist/web-cms"),
  WEB_DIST: z.string().trim().min(1).default("dist/web"),
  STATIC_DIR: z.string().trim().min(1).default("public"),
  STATIC_PATH: z
    .string()
    .regex(/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/)
    .default("/public")
    .transform((value) => value.replace(/\/$/, ""))
    .refine((value) => !/^\/api(?:\/|$)/.test(value)),
  WEB_CMS_PATH: z
    .string()
    .default("/web-cms")
    .transform((value, ctx) => {
      try {
        return webCmsPath(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid WEB_CMS_PATH" });
        return z.NEVER;
      }
    }),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
    .default("info"),
});
export type AppConfig = z.infer<typeof schema>;
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Only report keys, never echo connection credentials or invalid input values.
    throw new Error(
      `Invalid configuration: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  }
  if (
    result.data.APP_ENV === "production" &&
    result.data.AUTH_TRANSPORT === "cookie" &&
    !result.data.HTTP_IP_DIRECT &&
    !result.data.PUBLIC_ORIGIN.startsWith("https://")
  ) {
    throw new Error(
      "Invalid configuration: PUBLIC_ORIGIN must use HTTPS for production Cookie authentication",
    );
  }
  if (result.data.HTTP_IP_DIRECT) {
    const origin = new URL(result.data.PUBLIC_ORIGIN);
    if (
      origin.protocol !== "http:" ||
      isIP(origin.hostname) !== 4 ||
      origin.hostname === "0.0.0.0" ||
      origin.hostname === "255.255.255.255" ||
      result.data.AUTH_TRANSPORT !== "cookie" ||
      result.data.TRUST_PROXY_ADDRESSES.length > 0
    ) {
      throw new Error(
        "Invalid configuration: HTTP_IP_DIRECT requires an HTTP IPv4 PUBLIC_ORIGIN, Cookie authentication and no trusted proxy",
      );
    }
  }
  const { STATIC_PATH, WEB_CMS_PATH } = result.data;
  // 后台挂载在根路径时，具体的静态前缀优先于其通配路由。
  if (
    WEB_CMS_PATH !== "/" &&
    (STATIC_PATH === WEB_CMS_PATH ||
      STATIC_PATH.startsWith(`${WEB_CMS_PATH}/`) ||
      WEB_CMS_PATH.startsWith(`${STATIC_PATH}/`))
  )
    throw new Error(
      "Invalid configuration: STATIC_PATH conflicts with WEB_CMS_PATH",
    );
  return result.data;
}
