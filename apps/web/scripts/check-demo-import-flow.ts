import assert from "node:assert/strict";
import { AxiosHeaders, type AxiosResponse } from "axios";
import {
  createImportBoundary,
  awaitImport,
  readDemoSource,
  prepareDemoEntries,
  sourceHash,
  type ImportTask,
} from "../src/components/DemoImport/source";
import { request } from "../src/http";
import { demoImportApi } from "../src/api/demoImport";
const source = readDemoSource(
  JSON.stringify({
    state: {
      keys: [{ secret: "do-not-migrate" }],
      files: [
        {
          id: "folder",
          kind: "folder",
          name: "目录",
          space: "team",
          parent: null,
          password: "secret",
          public: true,
        },
        {
          id: "doc",
          kind: "doc",
          name: "图片文档",
          space: "team",
          parent: "folder",
          document: {
            type: "doc",
            content: [
              {
                type: "image",
                attrs: { src: "data:image/png;base64,aGVsbG8=" },
              },
              {
                type: "documentReference",
                attrs: { id: "folder", name: "目录" },
              },
            ],
          },
        },
        {
          id: "slide",
          kind: "slide",
          name: "PPT",
          space: "team",
          parent: null,
          presentation: { key: "original-ppt" },
        },
        {
          id: "sheet",
          kind: "sheet",
          name: "表格",
          space: "team",
          parent: null,
        },
        {
          id: "deleted",
          kind: "doc",
          name: "已删",
          space: "team",
          deleted: true,
        },
      ],
    },
  }),
);
assert.equal(source.length, 4);
assert.equal(
  JSON.stringify(source).includes("secret"),
  false,
  "旧密码和密钥不进入迁移清单",
);
assert.throws(() => readDemoSource("invalid"));
assert.equal(
  await sourceHash(source),
  await sourceHash(structuredClone(source)),
  "同一备份得到稳定任务身份",
);
const task: ImportTask = {
  key: "stable-task-key",
  userId: "u",
  target: "target",
  sourceHash: "hash",
  source: "team",
  assets: {},
};
let uploads = 0;
let persists = 0;
const dependencies: NonNullable<Parameters<typeof prepareDemoEntries>[5]> = {
  presentation: async (key) => {
    assert.equal(key, "original-ppt");
    return undefined;
  },
  sheet: async () => [
    {
      id: "s",
      name: "Sheet1",
      order: 0,
      celldata: [{ r: 0, c: 0, v: { v: 1 } }],
    },
  ],
  upload: async (space, file) => {
    assert.equal(space, "target");
    uploads++;
    return {
      id: `asset-${uploads}`,
      filename: file.name,
      mime: file.type,
      size: file.size,
      slides: file.name.endsWith("pptx") ? 2 : null,
      url: `/api/app/assets/asset-${uploads}`,
    };
  },
  parse: () => ({ type: "doc", content: [] }),
  xlsx: async () => [],
};
const first = await prepareDemoEntries(
  source,
  task,
  new Map(),
  () => {
    persists++;
  },
  () => {},
  dependencies,
);
assert.equal(
  first.entries.find((entry) => entry.oldId === "doc")?.parentOldId,
  "folder",
);
assert.equal(
  first.entries.find((entry) => entry.oldId === "slide")?.missingAssets,
  true,
  "缺失PPT不能伪造空文件成功",
);
assert.equal(first.missing[0].key, "slide:slide");
assert.equal(uploads, 1);
assert.equal(persists, 1, "附件上传后即时保存任务缓存支持断点重试");
const second = await prepareDemoEntries(
  source,
  task,
  new Map([["slide:slide", new File(["ppt"], "restored.pptx")]]),
  () => {},
  () => {},
  dependencies,
);
assert.equal(second.missing.length, 0);
assert.equal(uploads, 2, "重试复用已上传图片，仅补传缺失PPT");
assert.equal(
  second.entries.find((entry) => entry.oldId === "slide")?.missingAssets,
  undefined,
);
assert.equal(
  source[1].document?.content?.[0].attrs?.src,
  "data:image/png;base64,aGVsbG8=",
  "旧正文不被改写",
);
const calls: unknown[] = [];
request.defaults.adapter = async (config) => {
  calls.push(config.data ? JSON.parse(config.data) : config.url);
  const response: AxiosResponse = {
    data: { jobId: "job", status: "partial", mapping: {}, items: [] },
    status: 200,
    statusText: "OK",
    config,
    headers: new AxiosHeaders(),
  };
  return response;
};
await demoImportApi.run("target", task.key, first.entries);
await demoImportApi.run("target", task.key, second.entries);
assert.equal(
  (calls[0] as { idempotencyKey: string }).idempotencyKey,
  (calls[1] as { idempotencyKey: string }).idempotencyKey,
  "补附件沿用原幂等键",
);
await demoImportApi.result("target", "job");
assert.equal(calls[2], "/app/spaces/target/demo-imports/job");
// 延迟IndexedDB读取时切换账号，后续上传和转换必须停止。
let scope = { userId: "u", spaceId: "current" };
const boundary = createImportBoundary(() => scope);
let releaseRead!: (file: File) => void;
let cancelledUploads = 0;
const delayedRead = new Promise<File>((resolve) => {
  releaseRead = resolve;
});
const cancelledTask: ImportTask = { ...task, assets: {} };
const preparing = prepareDemoEntries(
  [source[2], source[1]],
  cancelledTask,
  new Map(),
  () => {
    throw new Error("取消任务不得保存新附件映射");
  },
  () => {},
  {
    ...dependencies,
    presentation: async () => delayedRead,
    upload: async () => {
      cancelledUploads++;
      throw new Error("不应上传");
    },
  },
  boundary,
);
scope = { userId: "other", spaceId: "current" };
releaseRead(new File(["ppt"], "cancelled.pptx"));
await assert.rejects(preparing);
assert.equal(cancelledUploads, 0, "读取返回后不能用新账号Cookie继续上传");
assert.deepEqual(cancelledTask.assets, {});
assert(boundary.signal.aborted);

// 上传已发出后切空间，迟到成功不能记录映射或发起下一个文件请求。
scope = { userId: "u", spaceId: "current" };
const uploadingBoundary = createImportBoundary(() => scope);
let releaseUpload!: (
  asset: Awaited<ReturnType<typeof dependencies.upload>>,
) => void;
const delayedUpload = new Promise<
  Awaited<ReturnType<typeof dependencies.upload>>
>((resolve) => {
  releaseUpload = resolve;
});
let signalReceived: AbortSignal | undefined;
let latePersists = 0;
const lateTask: ImportTask = { ...task, assets: {} };
const uploading = prepareDemoEntries(
  [source[1], source[2]],
  lateTask,
  new Map(),
  () => {
    latePersists++;
  },
  () => {},
  {
    ...dependencies,
    upload: async (_space, _file, signal) => {
      signalReceived = signal;
      return delayedUpload;
    },
  },
  uploadingBoundary,
);
assert.equal(signalReceived, uploadingBoundary.signal);
scope = { userId: "u", spaceId: "different" };
releaseUpload({
  id: "late",
  filename: "image.png",
  mime: "image/png",
  size: 1,
  slides: 0,
  url: "/api/app/assets/late",
});
await assert.rejects(uploading);
assert.equal(latePersists, 0);
assert.deepEqual(lateTask.assets, {});

// 登出后重新登录同账号仍不能复活旧任务；订阅产生的abort保持有效。
scope = { userId: "u", spaceId: "current" };
const sticky = createImportBoundary(() => scope);
sticky.controller.abort();
assert.throws(() => sticky.assertActive());
let resultApplied = false;
await assert.rejects(
  awaitImport(sticky, async () => {
    resultApplied = true;
    return "stale";
  }),
);
assert.equal(resultApplied, false);
const count = calls.length;
await assert.rejects(demoImportApi.run("target", task.key, [], sticky.signal));
assert.equal(calls.length, count, "取消信号在Axios发送前生效");
console.log(
  "演示导入前台流程验证通过：文件白名单、保留源、父子目录、快照转换接口、缺失附件失败、附件缓存与原任务重试",
);
