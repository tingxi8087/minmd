import assert from "node:assert/strict";
import { AxiosHeaders, type AxiosResponse } from "axios";
import type { RemoteFile } from "../src/api/files";
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
const { useWorkspace, fromRemoteFile } = await import("../src/store/workspace");
const { siblings, canMove, treeDropDestination } =
  await import("../src/utils/fileTree");
let remote: RemoteFile[] = [];
let moves = 0;
request.defaults.adapter = async (config) => {
  const path = config.url ?? "";
  const body =
    typeof config.data === "string"
      ? (JSON.parse(config.data) as Record<string, unknown>)
      : {};
  const response: AxiosResponse = {
    status: 200,
    statusText: "OK",
    headers: new AxiosHeaders(),
    config,
    data: {},
  };
  if (path === "/app/spaces/team/files" && config.method === "post") {
    const node: RemoteFile = {
      id: crypto.randomUUID(),
      name: String(body.name),
      kind: body.kind as RemoteFile["kind"],
      spaceId: "team",
      parentId: body.parentId as string | null,
      position: remote.filter((item) => item.parentId === body.parentId).length,
      createdBy: "owner",
      visibility: "private",
      metadataRevision: 1,
      deletedBatch: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      favorite: false,
      accessedAt: null,
    };
    remote.push(node);
    response.data = node;
  } else if (path.endsWith("/tree"))
    response.data = { items: remote.filter((item) => item.spaceId === "team") };
  else if (config.method === "get" && path.endsWith("/files"))
    response.data = { items: [], total: 0, page: 1, pageSize: 100 };
  else if (path.endsWith("/move")) {
    moves++;
    const id = path.split("/").at(-2);
    const moving = remote.find((item) => item.id === id);
    assert.ok(moving);
    assert.equal(body.expectedMetadataRevision, moving.metadataRevision);
    const destination = remote
      .filter((item) => item.parentId === body.parentId && item.id !== id)
      .sort((a, b) => a.position - b.position);
    const index =
      body.beforeId === undefined
        ? destination.length
        : destination.findIndex((item) => item.id === body.beforeId);
    assert.ok(index >= 0);
    moving.parentId = body.parentId as string | null;
    moving.metadataRevision++;
    destination.splice(index, 0, moving);
    destination.forEach((item, position) => {
      item.position = position;
    });
    response.data = moving;
  } else assert.fail(`未预期请求 ${config.method} ${path}`);
  return response;
};
useWorkspace.setState({
  loggedIn: true,
  space: "team",
  spaces: [
    {
      id: "team",
      name: "空间",
      description: "",
      ownerId: "owner",
      createdAt: "",
      updatedAt: "",
    },
  ],
});
const get = useWorkspace.getState;
const folder = await get().add("层级验收", "folder", null);
const nested = await get().add("二级目录", "folder", folder);
const parent = await get().add("父文档", "doc", nested);
const child = await get().add("子文档", "doc", parent);
const sheet = await get().add("表格", "sheet", null);
const personal: RemoteFile = {
  ...remote[0],
  id: "personal-note",
  kind: "doc",
  spaceId: "personal",
};
useWorkspace.setState({ files: [...get().files, fromRemoteFile(personal)] });
assert.equal(canMove(get().files, folder, nested), false);
assert.equal(await get().relocate(parent, child), false);
assert.equal(await get().relocate(sheet, parent), false);
assert.equal(await get().relocate(personal.id, folder), false);
assert.equal(moves, 0, "非法树移动不会调用后端");
assert.equal(await get().relocate(child, folder, 0), true);
assert.equal(siblings(get().files, "team", folder)[0].id, child);
assert.equal(await get().relocate(child, parent), true);
useWorkspace.setState({ files: [] });
await get().loadFiles();
assert.equal(
  get().files.find((file) => file.id === child)?.parent,
  parent,
  "刷新后读取服务器保存的父子关系",
);
assert.deepEqual(
  Object.keys(
    JSON.parse(storage.get("minmd-preferences-v2") ?? "{}").state,
  ).sort(),
  ["space", "theme"],
);
for (const gap of [false, true]) {
  const target = get().files.find((file) => file.id === nested);
  const moving = get().files.find((file) => file.id === child);
  assert.ok(target && moving);
  const destination = treeDropDestination(
    get().files,
    moving,
    target,
    gap ? 1 : 0,
    gap,
    true,
  );
  assert.deepEqual(destination, { parent: nested, index: 0 });
  assert.equal(
    await get().relocate(child, destination.parent, destination.index),
    true,
  );
  assert.equal(siblings(get().files, "team", nested)[0].id, child);
}
const target = get().files.find((file) => file.id === nested),
  moving = get().files.find((file) => file.id === child);
assert.ok(target && moving);
assert.equal(
  treeDropDestination(get().files, moving, target, 1, true, false).parent,
  folder,
);
console.log(
  "文件树验收通过：真实异步API嵌套、服务器刷新、首位排序、父子文档、循环/跨空间/类型限制与拖拽间隙",
);
