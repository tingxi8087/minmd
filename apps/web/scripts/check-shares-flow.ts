import assert from "node:assert/strict";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import { configureSession, request } from "../src/http";
import { sharesApi, shareLink } from "../src/api/shares";
import { publicDocument } from "../src/views/Share/projection";
let unauthorized = 0;
configureSession("csrf", () => {
  unauthorized++;
});
const calls: { path: string; data: unknown; credentials?: boolean }[] = [];
let fail = false;
request.defaults.adapter = async (config) => {
  calls.push({
    path: config.url ?? "",
    data: config.data ? JSON.parse(config.data) : undefined,
    credentials: config.withCredentials,
  });
  const response: AxiosResponse = {
    status: fail ? 401 : 200,
    statusText: "OK",
    headers: new AxiosHeaders(),
    config,
    data: {
      visibility: "public",
      enabled: true,
      hasPassword: true,
      expiresAt: null,
      generation: 1,
      token: "secret",
    },
  };
  if (fail)
    throw new AxiosError(
      "密码错误",
      "ERR_BAD_RESPONSE",
      config,
      undefined,
      response,
    );
  return response;
};
await sharesApi.save("id", { visibility: "public", expiresAt: null });
assert.deepEqual(
  calls.at(-1)?.data,
  { visibility: "public", expiresAt: null },
  "留空密码不覆盖已有密码",
);
await sharesApi.save("id", {
  visibility: "public",
  password: null,
  rotate: true,
});
assert.equal((calls.at(-1)?.data as { password: null }).password, null);
await sharesApi.public("token/quoted");
assert.equal(calls.at(-1)?.path, "/public/shares/token%2Fquoted/content");
await sharesApi.authenticate("token", "password");
assert.equal(calls.at(-1)?.path, "/public/shares/token/unlock");
assert.equal(calls.at(-1)?.credentials, true);
fail = true;
await assert.rejects(sharesApi.authenticate("token", "bad"));
assert.equal(unauthorized, 0, "匿名密码失败不得清除成员身份");
await assert.rejects(sharesApi.get("id"));
assert.equal(unauthorized, 1, "成员接口401仍清理身份");
assert.equal(
  shareLink("abc", "https://minmd.local/#/files"),
  "https://minmd.local/#/share/abc",
);
const original = {
  type: "doc",
  content: [
    {
      type: "image",
      attrs: { assetId: "image-id", src: "/api/app/assets/image-id" },
    },
    { type: "image", attrs: { src: "https://untrusted.local/image" } },
  ],
};
const projection = publicDocument(original, "token");
assert.equal(
  projection.content?.[0].attrs?.src,
  "/api/public/shares/token/assets/image-id",
);
assert.equal(
  projection.content?.[1].attrs?.src,
  "",
  "不读取无分享授权的图片地址",
);
assert.equal(
  original.content[0].attrs.src,
  "/api/app/assets/image-id",
  "访客地址改写不污染权威正文",
);
console.log(
  "分享前台流程验证通过：密码保留/清除、独立匿名路径、Cookie授权、401身份隔离与图片分享授权地址",
);
