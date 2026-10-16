import { beforeEach, expect, it, vi } from "vitest";
import { request } from "../src/http";
import { demoAdapter } from "../src/demo";
import { demoSpace, documents, files, resetData } from "../src/demo/data";
import { authApi } from "../src/api/auth";
import { filesApi } from "../src/api/files";
import { documentApi } from "../src/api/documents";
import { sheetApi } from "../src/api/sheets";
import { assetsApi } from "../src/api/assets";
beforeEach(() => {
  resetData();
  request.defaults.adapter = demoAdapter;
});
it("所有演示操作在内存中完成，删除目录、恢复、移动与刷新重置不污染示例", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(Error("不应访问网络"));
  const storage = vi.spyOn(Storage.prototype, "setItem");
  expect((await authApi.me()).user.nickname).toBe("体验者");
  const created = await filesApi.create(demoSpace.id, {
    kind: "doc",
    name: "临时文档",
    parentId: "ideas",
  });
  await filesApi.rename(demoSpace.id, created.id, "已修改", 1);
  await filesApi.favorite(demoSpace.id, created.id, true);
  const projection = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "只在内存" }] },
    ],
  };
  await documentApi.import(created.id, projection, 1, 1);
  expect((await documentApi.content(created.id)).projection).toEqual(
    projection,
  );
  await filesApi.remove(demoSpace.id, "ideas");
  expect(
    (await filesApi.trash(demoSpace.id)).some((f) => f.id === created.id),
  ).toBe(true);
  await filesApi.restore(demoSpace.id, "ideas");
  expect((await filesApi.get(created.id)).deletedAt).toBeNull();
  await filesApi.move(demoSpace.id, created.id, null, "welcome", 2);
  expect((await filesApi.get(created.id)).parentId).toBeNull();
  await expect(
    filesApi.move(demoSpace.id, "ideas", "ideas", undefined, 1),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  expect(storage).not.toHaveBeenCalled();
  resetData();
  expect(files.has(created.id)).toBe(false);
  expect(documents.get("welcome")).toBeDefined();
});
it("表格导入与读取使用内存，未知接口不会穿透到服务器", async () => {
  const original = await sheetApi.content("planning");
  const sheets = structuredClone(original.projection.sheets);
  sheets[0].name = "临时工作表";
  await sheetApi.import("planning", sheets, 1, 1);
  expect((await sheetApi.content("planning")).projection.sheets[0].name).toBe(
    "临时工作表",
  );
  await expect(
    request.post("/app/files/planning/collaboration-ticket", {}),
  ).rejects.toThrow("演示模式不提供");
  resetData();
  expect(
    (await sheetApi.content("planning")).projection.sheets[0].name,
  ).not.toBe("临时工作表");
});
it("图片上传通过对象URL预览，重置时释放文件", async () => {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:demo-upload");
      static revokeObjectURL = vi.fn();
    },
  );
  const file = new File(["image-bytes"], "demo.png", { type: "image/png" });
  const uploaded = await assetsApi.uploadMedia(
    demoSpace.id,
    file,
    null,
    file.name,
  );
  const content = await assetsApi.presentation(uploaded.id);
  expect(content.projection.assetId).toBeTruthy();
  const binary = await assetsApi.download(content.projection.assetId!);
  expect(binary.size).toBe(file.size);
  resetData();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:demo-upload");
  vi.unstubAllGlobals();
});

it("读取不修改时间，回收站子文档可以单独恢复", async () => {
  const file = files.get("diagrams")!;
  file.updatedAt = "2020-01-01T00:00:00.000Z";
  expect((await filesApi.get(file.id)).updatedAt).toBe(file.updatedAt);
  await filesApi.remove(demoSpace.id, "ideas");
  await filesApi.restore(demoSpace.id, "diagrams", null);
  expect((await filesApi.get("diagrams")).deletedAt).toBeNull();
  expect((await filesApi.get("diagrams")).parentId).toBeNull();
  expect((await filesApi.get("ideas")).deletedAt).not.toBeNull();
});
