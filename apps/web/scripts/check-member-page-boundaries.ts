import assert from "node:assert/strict";
import { createScopedTask } from "../src/utils/useScopedTask";
import { memberReturnPath, memberReturnState } from "../src/utils/memberReturn";
import { request } from "../src/http";
import { assetsApi, ASSET_TRANSFER_TIMEOUT_MS } from "../src/api/assets";
import { spaceApi } from "../src/api/spaces";
import { AxiosHeaders } from "axios";
for (const unsafe of [
  "https://evil.test",
  "//evil.test",
  "/\\evil.test",
  "/login",
  "/share/token",
  "/files\n",
  "/files#evil",
  "/settings/unknown",
  undefined,
])
  assert.equal(memberReturnPath(unsafe), "/files");
assert.equal(memberReturnPath("/document/abc-123"), "/document/abc-123");
assert.equal(memberReturnPath("/files?folder=abc"), "/files?folder=abc");
assert.deepEqual(
  memberReturnState({ returnTo: "/preview/uuid", returnSpace: "space-a" }),
  { path: "/preview/uuid", spaceId: "space-a" },
);
let scope = { identity: { id: "alice" }, spaceId: "space-a" };
const old = createScopedTask(() => scope);
let release!: (value: string) => void;
let writes = 0;
const pending = old
  .wait(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  )
  .then(() =>
    old.wait(async () => {
      writes++;
    }),
  );
scope = { identity: { id: "bob" }, spaceId: "space-a" };
release("上传成功");
await assert.rejects(pending);
assert.equal(writes, 0, "同空间换账号也不绑定旧上传");
assert.equal(old.signal.aborted, true);
const account = createScopedTask(() => scope);
scope = { identity: scope.identity, spaceId: "space-b" };
await assert.rejects(
  account.wait(async () => {
    writes++;
  }),
);
assert.equal(writes, 0, "换空间后不继续成员添加/读取");
const cancelled = createScopedTask(() => scope);
cancelled.controller.abort();
await assert.rejects(
  cancelled.wait(async () => {
    writes++;
  }),
);
const calls: string[] = [];
const descriptions: string[] = [];
request.defaults.adapter = async (config) => {
  calls.push(config.url ?? "");
  if (config.method === "patch") {
    const body = JSON.parse(config.data) as {
      name: string;
      description: string;
    };
    assert.equal(config.url, "/app/spaces/space");
    assert.equal(body.name, "团队空间");
    descriptions.push(body.description);
  }
  if (config.url?.includes("/assets")) {
    assert.equal(config.timeout, ASSET_TRANSFER_TIMEOUT_MS);
    assert.ok(config.signal);
  } else assert.ok(config.signal, "成员接口传取消信号");
  return {
    status: 200,
    statusText: "OK",
    config,
    headers: new AxiosHeaders(),
    data: { id: "asset", items: [], total: 0, page: 1, pageSize: 100 },
  };
};
const signal = new AbortController().signal;
await assetsApi.upload("space", new File(["pptx"], "file.pptx"), signal);
await assetsApi.download("asset", signal);
await spaceApi.accounts("space", "alice", signal);
await spaceApi.addMember("space", "alice", signal);
await spaceApi.members("space", 1, signal);
await spaceApi.update(
  "space",
  { name: "团队空间", description: "产品与设计资料" },
  signal,
);
await spaceApi.update("space", { name: "团队空间", description: "" }, signal);
assert.deepEqual(
  descriptions,
  ["产品与设计资料", ""],
  "空间资料支持保存和清空描述",
);
const aborted = new AbortController();
aborted.abort();
await assert.rejects(spaceApi.addMember("space", "bob", aborted.signal));
assert.equal(calls.length, 7);
console.log(
  "成员页面边界检查通过：站内返回白名单、目标空间、账号/空间切换取消异步链、成员信号、120秒附件传输、已取消请求不发送",
);
