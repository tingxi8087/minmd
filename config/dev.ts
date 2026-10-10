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
