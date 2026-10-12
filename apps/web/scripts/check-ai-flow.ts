import assert from "node:assert/strict";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import { request } from "../src/http";
import { aiApi, aiTemplates, aiPermissionNames } from "../src/api/ai";
const calls: { path: string; method: string; body: unknown }[] = [];
let conflict = false;
request.defaults.adapter = async (config) => {
  const body = config.data ? JSON.parse(config.data) : undefined;
  calls.push({ path: config.url ?? "", method: config.method ?? "get", body });
  const response: AxiosResponse = {
    status: conflict ? 403 : 200,
    statusText: "OK",
    headers: new AxiosHeaders(),
    config,
    data: config.url?.endsWith("api-keys")
      ? config.method === "post"
        ? {
            key: { id: "key", prefix: "minmd_prefix" },
            secret: "minmd_secret_once",
          }
        : { items: [{ id: "key", prefix: "minmd_prefix" }] }
      : (body ?? { enabled: false, permissions: ["read"] }),
  };
  if (conflict)
    throw new AxiosError(
      "密钥无权操作",
      "ERR_BAD_RESPONSE",
      config,
      undefined,
      response,
    );
  return response;
};
const key = await aiApi.create("space", {
  name: "助手",
  permissions: ["read"],
  expiresAt: null,
});
assert.equal(key.secret, "minmd_secret_once");
assert.deepEqual(calls.at(-1)?.body, {
  name: "助手",
  permissions: ["read"],
  expiresAt: null,
});
const list = await aiApi.keys("space");
assert.equal("secret" in list[0], false, "列表仅包含密钥识别元数据");
conflict = true;
await assert.rejects(
  aiApi.create("space", {
    name: "越权",
    permissions: ["edit"],
    expiresAt: null,
  }),
  "后端拒绝权限时不得伪造创建成功",
);
conflict = false;
await aiApi.update("key", {
  name: "修改助手",
  permissions: ["read", "edit"],
  expiresAt: null,
});
assert.equal(calls.at(-1)?.method, "patch");
assert.equal(calls.at(-1)?.path, "/app/api-keys/key");
await aiApi.reveal("key");
assert.equal(calls.at(-1)?.path, "/app/api-keys/key/reveal");
assert.deepEqual(calls.at(-1)?.body, {});
await aiApi.revoke("key");
assert.equal(calls.at(-1)?.path, "/app/api-keys/key");
assert.equal(calls.at(-1)?.method, "delete");
const template = aiTemplates("https://docs.example");
assert.equal(
  JSON.parse(template.mcp).mcpServers.minmd.url,
  "https://docs.example/mcp",
);
assert.match(template.http, /https:\/\/docs.example\/api\/v1/);
assert.match(template.http, /Authorization: Bearer <API_KEY>/);
assert.equal(template.mcp.includes("?"), false, "密钥不拼接在URL中");
assert.deepEqual(Object.keys(aiPermissionNames), [
  "read",
  "create",
  "edit",
  "organize",
  "delete_restore",
  "upload",
]);
console.log(
  "AI前台流程验证通过：六项独立密钥权限、创建与修改、独立查看接口、无明文列表、拒绝授权不假成功、删除与Bearer模板",
);
