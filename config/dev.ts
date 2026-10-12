/** 前后台开发端口使用相同校验，避免错误配置自动漂移到其他端口。 */
export function readDevPort(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new Error("开发端口必须是 1–65535 的整数");
  const port = Number(value);
  if (port < 1 || port > 65535)
    throw new Error("开发端口必须是 1–65535 的整数");
  return port;
}

/** 开发网页代理只连接本机 Vite，不能通过请求选择上游。 */
export function loadDevConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const enabled = env.WEB_DEV_PROXY ?? "true";
  if (!["true", "false"].includes(enabled))
    throw new Error("WEB_DEV_PROXY 必须是 true 或 false");
  const webPort = readDevPort(env.WEB_PORT, 5173);
  const cmsPort = readDevPort(env.WEB_CMS_PORT, 5174);
  const serverPort = readDevPort(env.PORT, 9811);
  if (new Set([webPort, cmsPort, serverPort]).size !== 3)
    throw new Error("前台、后台和后端开发端口不能重复");
  return { enabled: enabled === "true", webPort, cmsPort, serverPort };
}
