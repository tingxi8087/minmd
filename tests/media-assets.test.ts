import { expect, test } from "bun:test";
import { byteRange } from "../apps/app_server/src/modules/assets/send";
import { validateMediaAsset } from "../apps/app_server/src/modules/assets/media-validation";
test("分段请求支持前缀、后缀和开放范围，拒绝越界及多范围", () => {
  expect(byteRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
  expect(byteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
  expect(byteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  expect(byteRange("bytes=90-150", 100)).toEqual({ start: 90, end: 99 });
  for (const range of [
    "bytes=100-",
    "bytes=-0",
    "bytes=8-2",
    "bytes=0-1,4-8",
    "bytes=-",
    "bytes=NaN-",
    "bytes=999999999999999999999-",
  ])
    expect(byteRange(range, 100)).toBeNull();
  expect(byteRange("bytes=0-", 0)).toBeNull();
});
test("独立预览只接受扩展名、MIME及实际签名相符的媒体", () => {
  expect(
    validateMediaAsset(
      Buffer.from("%PDF-1.7\n%%EOF"),
      "a.pdf",
      "application/pdf",
    ).kind,
  ).toBe("pdf");
  const mp4 = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypisom00000000"),
  ]);
  expect(validateMediaAsset(mp4, "a.mp4", "video/mp4").kind).toBe("video");
  for (const [bytes, name, mime] of [
    [Buffer.from("<html>"), "a.pdf", "application/pdf"],
    [mp4, "a.webm", "video/webm"],
    [mp4, "a.mp4", "text/html"],
  ] as const)
    expect(() => validateMediaAsset(bytes, name, mime)).toThrow();
});

test("独立图片和PDF大小限制不会被视频上限放宽", () => {
  const image = Buffer.alloc(20 * 1024 * 1024 + 1);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(image);
  image.write("IHDR", 12, "ascii");
  expect(() => validateMediaAsset(image, "large.png", "image/png")).toThrow(
    "20 MB",
  );
});
