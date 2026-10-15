import { expect, it } from "vitest";
import { assertUploadSize, UPLOAD_MAX_BYTES } from "../src/utils/uploadLimits";
it("所有格式使用200MB统一边界，允许恰好200MB，拒绝超限和空文件", () => {
  expect(UPLOAD_MAX_BYTES).toBe(200 * 1024 * 1024);
  for (const size of [
    1,
    20 * 1024 * 1024 + 1,
    50 * 1024 * 1024 + 1,
    UPLOAD_MAX_BYTES,
  ])
    expect(() => assertUploadSize({ size })).not.toThrow();
  for (const size of [0, UPLOAD_MAX_BYTES + 1])
    expect(() => assertUploadSize({ size })).toThrow("200 MB");
});
