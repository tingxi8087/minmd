import assert from "node:assert/strict";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
};
Object.defineProperty(globalThis, "window", {
  value: { localStorage: localStorageMock },
});
const { request } = await import("../src/http");
const { useWorkspace } = await import("../src/store/workspace");
const calls: { path: string; method: string; data: Record<string, unknown> }[] =
  [];
const first = {
  id: "first",
  spaceId: "one",
  kind: "doc" as const,
  name: "第一项",
  parentId: "folder",
  position: 0,
  createdBy: "owner",
  visibility: "private" as const,
  metadataRevision: 1,
  deletedBatch: null,
  deletedAt: null,
  favorite: false,
  accessedAt: null,
  createdAt: "2026-10-11",
  updatedAt: "2026-10-11",
};
const folder = {
  ...first,
  id: "folder",
  kind: "folder" as const,
  parentId: null,
  name: "文件夹",
};
const moving = { ...first, id: "moving", parentId: null, name: "待移动" };
let rows = [folder, first, moving];
let rejectRename = false;
let delayedTree: (() => void) | undefined;
let delayOne = false;
request.defaults.adapter = async (config) => {
  const path = config.url ?? "";
  const data: Record<string, unknown> =
    typeof config.data === "string"
      ? JSON.parse(config.data)
      : (config.data ?? {});
  calls.push({ path, method: config.method ?? "", data });
  const response: AxiosResponse = {
    status: 200,
    statusText: "OK",
    headers: new AxiosHeaders(),
    config,
    data: { ok: true },
  };
  if (path.endsWith("/tree")) {
    if (delayOne && path.includes("/one/"))
      await new Promise<void>((resolve) => {
        delayedTree = resolve;
      });
    response.data = {
      items: path.includes("/one/") ? rows.filter((row) => !row.deletedAt) : [],
    };
  } else if (path.endsWith("/files") && config.method === "get")
    response.data = {
      items: rows.filter((row) => row.deletedAt),
      total: 0,
      page: 1,
      pageSize: 100,
    };
  else if (path.endsWith("/files") && config.method === "post") {
    const created = {
      ...first,
      id: crypto.randomUUID(),
      name: String(data.name),
      parentId: data.parentId as string | null,
    };
    rows.push(created);
    response.data = created;
  } else if (config.method === "patch") {
    if (rejectRename) {
      response.status = 409;
      response.data = { code: "REVISION_CONFLICT", message: "文件已被修改" };
      throw new AxiosError(
        "冲突",
        "ERR_BAD_RESPONSE",
        config,
        undefined,
        response,
      );
    }
    rows = rows.map((row) =>
      path.endsWith(row.id)
        ? {
            ...row,
            name: String(data.name),
            metadataRevision: row.metadataRevision + 1,
          }
        : row,
    );
    response.data = rows.find((row) => path.endsWith(row.id));
  }
  return response;
};
useWorkspace.setState({
  loggedIn: true,
  spaces: [
    {
      id: "one",
      name: "空间一",
      description: "",
      ownerId: "owner",
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "two",
      name: "空间二",
      description: "",
      ownerId: "owner",
      createdAt: "",
      updatedAt: "",
    },
  ],
});
await useWorkspace.getState().setSpace("one");
assert.equal(useWorkspace.getState().files.length, 3);
await useWorkspace.getState().relocate("moving", "folder", 0);
const move = calls.find((call) => call.path === "/app/files/moving/move");
assert.equal(move?.data.beforeId, "first", "拖到目录首位提交首兄弟 beforeId");
assert.equal(move?.data.parentId, "folder");
rejectRename = true;
await assert.rejects(
  useWorkspace.getState().patch("first", { name: "冲突名" }),
);
assert.equal(
  useWorkspace.getState().files.find((row) => row.id === "first")?.name,
  "第一项",
  "失败不写入假元数据",
);
rejectRename = false;
const id = await useWorkspace.getState().add("服务器新文档", "doc", null);
assert.match(id, /^[a-f0-9-]{36}$/);
assert.equal(
  useWorkspace.getState().files.find((file) => file.id === id)?.name,
  "服务器新文档",
);
delayOne = true;
const old = useWorkspace.getState().loadFiles();
await Promise.resolve();
await useWorkspace.getState().setSpace("two");
delayedTree?.();
await old;
assert.equal(useWorkspace.getState().space, "two");
assert.deepEqual(
  useWorkspace.getState().files,
  [],
  "旧空间响应不会回填到新空间",
);
assert.deepEqual(
  Object.keys(
    JSON.parse(storage.get("minmd-preferences-v2") ?? "{}").state,
  ).sort(),
  ["space", "theme"],
);
console.log(
  "文件API流程验证通过：真实创建、首位排序、修订冲突不假保存、跨空间响应隔离、私有业务不落localStorage",
);

const { loadCreatorNames, creatorName } =
  await import("../src/views/Files/creators");
request.defaults.adapter = async (config) => ({
  status: 200,
  statusText: "OK",
  headers: new AxiosHeaders(),
  config,
  data: {
    items: [
      { id: "alice", nickname: "Alice", account: "alice" },
      { id: "bob", nickname: "", account: "bob" },
    ],
    total: 2,
    page: 1,
    pageSize: 100,
  },
});
const names = await loadCreatorNames("space", new AbortController().signal);
assert.equal(creatorName("alice", names, true, false), "Alice");
assert.equal(creatorName("bob", names, true, false), "bob");
assert.equal(creatorName("removed", names, true, false), "已离开空间的成员");
assert.equal(creatorName("unknown", {}, true, true), "成员信息不可用");
let releaseMembers!: () => void;
const pauseMembers = new Promise<void>((resolve) => {
  releaseMembers = resolve;
});
request.defaults.adapter = async (config) => {
  await pauseMembers;
  return {
    status: 200,
    statusText: "OK",
    headers: new AxiosHeaders(),
    config,
    data: {
      items: [{ id: "old", nickname: "旧空间成员", account: "old" }],
      total: 1,
      page: 1,
      pageSize: 100,
    },
  };
};
const oldMembers = new AbortController();
const delayedNames = loadCreatorNames("old-space", oldMembers.signal);
await Promise.resolve();
oldMembers.abort();
releaseMembers();
await assert.rejects(
  delayedNames,
  "旧空间成员响应必须被取消，不得应用到新页面",
);
console.log(
  "创建者显示验证通过：昵称/账号、移除成员中文兜底、旧身份空间响应取消",
);
