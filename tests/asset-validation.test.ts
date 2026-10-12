import { expect, test } from "bun:test";
import JSZip from "jszip";
import {
  validateAsset,
  pptxMime,
} from "../apps/app_server/src/modules/assets/validate";
export const pngFixture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
test("图片使用实际内容类型并拒绝伪造MIME和超限", async () => {
  expect((await validateAsset(pngFixture, "image.png", "image/png")).mime).toBe(
    "image/png",
  );
  await expect(
    validateAsset(pngFixture, "image.jpg", "image/jpeg"),
  ).rejects.toThrow("文件类型");
  await expect(
    validateAsset(Buffer.from("<svg/>"), "image.svg", "image/svg+xml"),
  ).rejects.toThrow("文件类型");
  await expect(
    validateAsset(Buffer.alloc(1024 * 1024 + 1), "image.png", "image/png"),
  ).rejects.toThrow("1 MB");
});
test("PPTX必须包含OOXML结构、内容类型和幻灯片", async () => {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
  );
  zip.file("_rels/.rels", "<Relationships/>");
  zip.file("ppt/presentation.xml", '<p:presentation xmlns:p="test"/>');
  zip.file("ppt/slides/slide1.xml", "<p:sld/>");
  expect(
    await validateAsset(
      await zip.generateAsync({ type: "nodebuffer" }),
      "test.pptx",
      pptxMime,
    ),
  ).toEqual({ mime: pptxMime, slides: 1 });
  zip.remove("ppt/presentation.xml");
  await expect(
    validateAsset(
      await zip.generateAsync({ type: "nodebuffer" }),
      "test.pptx",
      pptxMime,
    ),
  ).rejects.toThrow("文件类型");
  await expect(
    validateAsset(Buffer.from("PKbad"), "test.pptx", pptxMime),
  ).rejects.toThrow("文件类型");
});
