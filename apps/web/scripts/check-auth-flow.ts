import assert from "node:assert/strict";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});
Object.defineProperty(globalThis, "window", {
  value: { localStorage: globalThis.localStorage },
});
const { request } = await import("../src/http");
const { useAuth } = await import("../src/store/auth");
const { useWorkspace } = await import("../src/store/workspace");
const calls: { path: string; method: string; csrf: unknown }[] = [];
let failLogout = false;
let expired = false;
let rejectOldRequest: (() => void) | undefined;
let startedOldRequest: (() => void) | undefined;
request.defaults.adapter = async (config) => {
  calls.push({
    path: config.url ?? "",
    method: config.method ?? "",
    csrf: config.headers.get("x-csrf-token"),
  });
  const response: AxiosResponse = {
    status: 200,
    statusText: "OK",
    headers: new AxiosHeaders(),
    config,
    data: {},
  };
  if (config.url === "/app/late-session-response") {
    startedOldRequest?.();
    await new Promise<void>((_resolve, reject) => {
      rejectOldRequest = () => {
        response.status = 401;
        reject(
          new AxiosError(
            "旧会话已失效",
            "ERR_BAD_RESPONSE",
            config,
            undefined,
            response,
          ),
        );
      };
    });
  }
  if (expired || (failLogout && config.url === "/app/auth/logout")) {
    response.status = expired ? 401 : 500;
    response.data = { message: "测试失败" };
    throw new AxiosError(
      "测试失败",
      "ERR_BAD_RESPONSE",
      config,
      undefined,
      response,
    );
  }
  if (config.url === "/app/auth/login")
    response.data = { csrfToken: "login-csrf" };
  if (config.url === "/app/auth/me")
    response.data = {
      user: {
        id: "owner",
        account: "test_user",
        nickname: "测试账号",
        avatar: "",
      },
      permissions: [],
      csrfToken: "me-csrf",
    };
  if (config.url?.endsWith("/tree")) response.data = { items: [] };
  if (config.url?.endsWith("/files"))
    response.data = { items: [], total: 0, page: 1, pageSize: 100 };
  if (config.url === "/app/spaces")
    response.data = {
      items: [
        {
          id: "real-space",
          name: "真实空间",
          ownerId: "owner",
          description: "",
          createdAt: "",
          updatedAt: "",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    };
  return response;
};
await useAuth.getState().login("test_user", "test-password");
assert.equal(useAuth.getState().status, "authenticated");
assert.equal(useWorkspace.getState().space, "real-space");
assert.deepEqual(useWorkspace.getState().files, [], "真实空间不混入演示文件");
await request.post("/app/spaces", { name: "空间" });
assert.equal(calls.at(-1)?.csrf, "me-csrf", "登录后写请求附带me返回的CSRF令牌");
failLogout = true;
await assert.rejects(useAuth.getState().logout());
assert.equal(
  useAuth.getState().status,
  "authenticated",
  "退出失败时不能显示已退出",
);
failLogout = false;
expired = true;
await assert.rejects(request.get("/app/spaces"));
assert.equal(useAuth.getState().status, "anonymous");
assert.deepEqual(useWorkspace.getState().spaces, []);
assert.deepEqual(useWorkspace.getState().files, []);
expired = false;
await useAuth.getState().login("test_user", "test-password");
const oldStarted = new Promise<void>((resolve) => {
  startedOldRequest = resolve;
});
const oldResponse = request.get("/app/late-session-response");
const oldRejected = assert.rejects(oldResponse);
await oldStarted;
await useAuth.getState().logout();
await useAuth.getState().login("test_user", "test-password");
rejectOldRequest?.();
await oldRejected;
assert.equal(
  useAuth.getState().status,
  "authenticated",
  "旧账号请求晚到的401不能清除新登录会话",
);
assert.equal(
  useWorkspace.getState().space,
  "real-space",
  "旧401不能清空新会话空间",
);
await useAuth.getState().logout();
assert.equal(useAuth.getState().user, null);
assert.equal(calls.at(-1)?.csrf, "me-csrf");
const preferences = JSON.parse(storage.get("minmd-preferences-v2") ?? "{}");
assert.deepEqual(
  Object.keys(preferences.state).sort(),
  ["space", "theme"],
  "身份、CSRF、私有文件不持久化",
);
console.log(
  "前台认证流程验证通过：Cookie CSRF、真实空间、退出失败、当前401清缓存、旧401不清新会话、退出成功",
);
