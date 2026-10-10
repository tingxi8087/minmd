import { expect, test } from "bun:test";
import { closeClientOnce } from "../scripts/database/close-client";

test("database close is shared and a stalled connection fails within a bounded time", async () => {
  let calls = 0;
  const close = closeClientOnce(
    {
      end: () => {
        calls++;
        return new Promise<void>(() => {});
      },
    },
    20,
  );
  const first = close();
  expect(close()).toBe(first);
  await expect(first).rejects.toThrow("关闭数据库连接超时");
  await expect(close()).rejects.toThrow("关闭数据库连接超时");
  expect(calls).toBe(1);
});

test("database close resolves normally and is not repeated during final cleanup", async () => {
  let calls = 0;
  const close = closeClientOnce({
    end: async () => {
      calls++;
    },
  });
  await close();
  await close();
  expect(calls).toBe(1);
});
