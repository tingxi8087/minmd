import assert from "node:assert/strict";
import {
  saveImportedContent,
  type PendingImport,
} from "../src/views/Files/importFlow";
const task: PendingImport = {
  file: new File(["source"], "验收.xlsx"),
  userId: "alice",
  spaceId: "space-a",
};
let active = true,
  creates = 0,
  fail = true,
  revision = 0,
  epoch = 1,
  confirms = 0;
const calls: { id: string; revision: number; epoch: number }[] = [];
const dependencies = {
  assertActive: () => {
    if (!active) throw new DOMException("身份已切换", "AbortError");
  },
  create: async () => {
    creates++;
    return "same-target";
  },
  content: async () => ({ revision, epoch }),
  confirmReplace: async () => {
    confirms++;
    return true;
  },
  write: async (
    id: string,
    _projection: { value: number },
    base: number,
    baseEpoch: number,
  ) => {
    calls.push({ id, revision: base, epoch: baseEpoch });
    if (fail) throw new Error("服务器拒绝写入");
  },
};
await assert.rejects(
  saveImportedContent(task, { value: 7 }, dependencies),
  /服务器拒绝/,
);
assert.equal(task.createdId, "same-target");
assert.equal(await task.file.text(), "source");
assert.equal(creates, 1);
fail = false;
assert.equal(
  await saveImportedContent(task, { value: 7 }, dependencies),
  "same-target",
);
assert.equal(creates, 1);
assert.equal(confirms, 0);
revision = 5;
epoch = 2;
await saveImportedContent(task, { value: 7 }, dependencies);
assert.equal(confirms, 1);
assert.deepEqual(calls.at(-1), { id: "same-target", revision: 5, epoch: 2 });
revision++;
await assert.rejects(
  saveImportedContent(
    task,
    { value: 7 },
    { ...dependencies, confirmReplace: async () => false },
  ),
  /取消覆盖/,
);
assert.equal(calls.length, 3);
active = false;
await assert.rejects(
  saveImportedContent(task, { value: 7 }, dependencies),
  /身份已切换/,
);
assert.equal(calls.length, 3);
active = true;
const newTask: PendingImport = {
  file: task.file,
  userId: "alice",
  spaceId: "space-a",
};
await assert.rejects(
  saveImportedContent(
    newTask,
    { value: 7 },
    {
      ...dependencies,
      create: async () => {
        active = false;
        return "old-scope-target";
      },
    },
  ),
  /身份已切换/,
);
assert.equal(newTask.createdId, "old-scope-target");
assert.equal(calls.length, 3);
console.log(
  "导入保存验证通过：服务端失败保留原文件/目标，重试复用目标，变更确认及 revision/epoch 基线，身份切换停止后续写入。",
);
const { request } = await import("../src/http");
const { sheetApi } = await import("../src/api/sheets");
const { AxiosHeaders, AxiosError } = await import("axios");
let serverProjection = {
  sheets: [
    { id: "tab-1", name: "Sheet1", celldata: [{ r: 0, c: 0, v: { v: 7 } }] },
  ],
};
let rejectServer = false;
request.defaults.adapter = async (config) => {
  const response = {
    status: 200,
    statusText: "OK",
    headers: new AxiosHeaders(),
    config,
    data: {} as object,
  };
  if (config.url?.endsWith("/content-import")) {
    const body = JSON.parse(String(config.data));
    assert.equal(body.expectedRevision, 5);
    assert.equal(body.expectedEpoch, 2);
    assert.deepEqual(body.projection.sheets, serverProjection.sheets);
    if (rejectServer)
      throw new AxiosError(
        "权限已变化",
        "ERR_BAD_RESPONSE",
        config,
        undefined,
        { ...response, status: 403 },
      );
    serverProjection = body.projection;
    response.data = {
      fileId: "target",
      revision: 6,
      epoch: 3,
      savedAt: "2026-10-12",
    };
  } else {
    assert.equal(config.url, "/app/files/target/content");
    response.data = {
      fileId: "target",
      projection: structuredClone(serverProjection),
      revision: 6,
      epoch: 3,
      savedAt: "2026-10-12",
      schemaVersion: 1,
    };
  }
  return response;
};
await sheetApi.import("target", serverProjection.sheets, 5, 2);
assert.equal(
  (await sheetApi.content("target")).projection.sheets[0].celldata?.[0].v.v,
  7,
);
rejectServer = true;
await assert.rejects(sheetApi.import("target", serverProjection.sheets, 5, 2));
const controller = new AbortController();
controller.abort();
await assert.rejects(
  sheetApi.import("target", serverProjection.sheets, 5, 2, controller.signal),
);
console.log(
  "表格真实请求契约验证通过：content-import 服务端读取回查、403失败传播、取消请求不发送。",
);
