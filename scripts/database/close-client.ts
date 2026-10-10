import type { Client } from "pg";

/** 关闭只执行一次；异常连接不能让清理阶段无限等待。 */
export function closeClientOnce(client: Pick<Client, "end">, timeoutMs = 5000) {
  let closing: Promise<void> | undefined;
  return () => {
    closing ??= new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("关闭数据库连接超时；请检查数据库状态后重试。")),
        timeoutMs,
      );
      Promise.resolve()
        .then(() => client.end())
        .then(resolve, reject)
        .finally(() => clearTimeout(timeout));
    });
    return closing;
  };
}
