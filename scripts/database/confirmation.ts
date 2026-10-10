import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

/** 每次单独读取一行，使用终端自身的行编辑，避免复用 question 的交互状态。 */
export function readConfirmation(
  question: string,
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = createInterface({
      input,
      terminal: false,
      crlfDelay: Infinity,
    });
    let submitted = false;
    reader.once("line", (line) => {
      submitted = true;
      reader.close();
      resolve(line);
    });
    reader.once("close", () => {
      if (!submitted) reject(new Error("输入已结束，已取消本次操作。"));
    });
    reader.once("error", reject);
    output.write(question);
    input.resume();
  });
}
