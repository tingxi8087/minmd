import { resolve } from "node:path";
import { resetDatabase } from "./database/reset";
import { readConfirmation } from "./database/confirmation";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error(
    "db:reset 需要交互终端和两次手动确认，不支持管道输入或跳过确认。",
  );
  process.exitCode = 1;
} else {
  try {
    if (!process.env.DATABASE_URL)
      throw new Error("请在 .env 中设置 DATABASE_URL。");
    await resetDatabase({
      root: resolve(import.meta.dir, ".."),
      connectionString: process.env.DATABASE_URL,
      confirm: async (question) => {
        const answer = await readConfirmation(question);
        console.log("已收到本次确认输入。");
        return answer;
      },
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "数据库重置失败。");
    process.exitCode = 1;
  } finally {
    process.stdin.pause();
  }
  // 出错时异常 socket 可能仍存活，避免命令继续占用终端。
  if (process.exitCode) process.exit(process.exitCode);
}
