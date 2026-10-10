import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { readConfirmation } from "../scripts/database/confirmation";

for (const newline of ["\r", "\n", "\r\n"]) {
  test(`two separated confirmations submit with ${JSON.stringify(newline)}`, async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    try {
      const first = readConfirmation("database: ", input, output);
      input.write(`mas_test${newline}`);
      expect(await first).toBe("mas_test");
      await Bun.sleep(10);
      const second = readConfirmation("RESET: ", input, output);
      input.write("RE");
      input.write(`SET${newline}`);
      expect(await second).toBe("RESET");
      expect(input.listenerCount("data")).toBe(0);
    } finally {
      input.destroy();
      output.destroy();
    }
  });
}

test("EOF cancels confirmation without submitting a destructive answer", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const answer = readConfirmation("RESET: ", input, output);
  input.end();
  await expect(answer).rejects.toThrow("已取消");
  output.destroy();
});
