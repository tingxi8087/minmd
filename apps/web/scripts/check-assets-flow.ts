import assert from "node:assert/strict";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import { request } from "../src/http";
import { assetsApi } from "../src/api/assets";
import { documentApi } from "../src/api/documents";
import { parseMarkdownDocument } from "../src/views/Document/utils/markdownImport";
const calls: { method: string; path: string; body: unknown }[] = [];
let rejectBinding = false;
request.defaults.adapter = async (config) => {
  const path = config.url ?? "";
  const body: unknown =
    typeof config.data === "string" ? JSON.parse(config.data) : config.data;
  calls.push({ method: config.method ?? "", path, body });
  const response: AxiosResponse = {
    status: 200,
    statusText: "OK",
    headers: new AxiosHeaders(),
    config,
    data: {},
  };
  if (config.signal?.aborted)
    throw new AxiosError("已取消", "ERR_CANCELED", config);
  if (path.endsWith("/assets")) {
    assert.ok(body instanceof FormData);
    const file = body.get("file");
    assert.ok(file instanceof File);
    assert.equal(file.name, "preview.pptx");
    response.data = {
      id: "private-asset",
      filename: file.name,
      mime: file.type,
      size: file.size,
      slides: 2,
      url: "/api/app/assets/private-asset",
    };
  } else if (path === "/app/assets/private-asset")
    response.data = new Blob(["PPTX原文件"]);
  else if (path.endsWith("/content"))
    response.data = { fileId: "slide", revision: 2, epoch: 1, projection: {} };
  else if (path.endsWith("/presentation")) {
    if (rejectBinding) {
      response.status = 409;
      response.data = { message: "幻灯片内容已变化" };
      throw new AxiosError(
        "冲突",
        "ERR_BAD_RESPONSE",
        config,
        undefined,
        response,
      );
    }
    response.data = {
      fileId: "slide",
      revision: 3,
      epoch: 2,
      projection: {
        assetId: "private-asset",
        name: "preview.pptx",
        size: 10,
        slides: 2,
      },
    };
  } else if (path.endsWith("/content-import"))
    response.data = { fileId: "doc", revision: 2, epoch: 2 };
  else assert.fail(`未预期请求 ${path}`);
  return response;
};
const binary = new File(["PPTX原文件"], "preview.pptx", {
  type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
});
const asset = await assetsApi.upload("space", binary);
const basis = await assetsApi.presentation("slide");
const bound = await assetsApi.bindPresentation("slide", asset.id, basis);
assert.equal(bound.projection.assetId, asset.id);
const bindCall = calls.find((call) => call.path.endsWith("/presentation"));
assert.deepEqual(bindCall?.body, {
  assetId: "private-asset",
  expectedRevision: 2,
  expectedEpoch: 1,
});
assert.equal(await (await assetsApi.download(asset.id)).text(), "PPTX原文件");
rejectBinding = true;
await assert.rejects(assetsApi.bindPresentation("slide", asset.id, basis));
const controller = new AbortController();
controller.abort();
await assert.rejects(assetsApi.download(asset.id, controller.signal));
const projection = parseMarkdownDocument(
  "# 服务端导入\n\n正文 **加粗**\n\n- [x] 完成\n\n```typescript\nconst value = 1;\n```\n\n| 方案 | 结果 |\n| --- | --- |\n| A | 正常 |\n",
);
assert.equal(projection.type, "doc");
assert.ok(projection.content?.some((node) => node.type === "heading"));
assert.ok(projection.content?.some((node) => node.type === "taskList"));
assert.ok(projection.content?.some((node) => node.type === "table"));
assert.equal(
  projection.content?.find((node) => node.type === "codeBlock")?.attrs
    ?.language,
  "typescript",
);
await documentApi.import("doc", projection, 1, 1);
const imported = calls.at(-1);
assert.equal(imported?.path, "/app/files/doc/content-import");
assert.deepEqual(
  imported?.body,
  JSON.parse(
    JSON.stringify({ projection, expectedRevision: 1, expectedEpoch: 1 }),
  ),
);
console.log(
  "资产与导入流程验证通过：私有PPT上传/下载、revision/epoch绑定冲突、取消请求、完整Markdown解析与服务器导入",
);
