import { afterEach, expect, it, vi } from "vitest";
import { filesApi } from "../src/api/files";
import type { Entry } from "../src/store/workspace";
import { createScopedTask } from "../src/utils/useScopedTask";
import { selectionRoots, deleteSelection } from "../src/views/Files/selection";

const entry = (
  id: string,
  parent: string | null = null,
  permission: Entry["permission"] = "manage",
): Entry => ({
  id,
  parent,
  permission,
  kind: "doc",
  space: "space",
  name: id,
  favorite: false,
  public: false,
  deleted: false,
  updated: "",
  owner: "owner",
});
const task = () =>
  createScopedTask(() => ({ identity: "user", spaceId: "space" }));
afterEach(() => vi.restoreAllMocks());
it("父子同时选中只删除父项，未选中的祖先不影响子项", () => {
  const files = [
    entry("parent"),
    entry("child", "parent"),
    entry("nested", "child"),
    entry("other"),
  ];
  expect(
    selectionRoots(files, ["parent", "nested", "other"]).map((f) => f.id),
  ).toEqual(["parent", "other"]);
  expect(selectionRoots(files, ["child", "nested"]).map((f) => f.id)).toEqual([
    "child",
  ]);
});
it("部分删除失败保留失败项，成功项不会再次提交；请求携带取消信号", async () => {
  const remove = vi.spyOn(filesApi, "remove").mockResolvedValue(undefined);
  remove.mockRejectedValueOnce(new Error("无权限"));
  const operation = task();
  expect(
    await deleteSelection([entry("a"), entry("b")], ["a", "b"], operation),
  ).toEqual({ failed: ["a"], deleted: 1 });
  expect(remove.mock.calls).toEqual([
    ["space", "a", operation.signal],
    ["space", "b", operation.signal],
  ]);
  await deleteSelection([entry("a"), entry("b")], ["a"], task());
  expect(remove.mock.calls.map((call) => call[1])).toEqual(["a", "b", "a"]);
});
it("包含无管理权限的目标时整批不提交", async () => {
  const remove = vi.spyOn(filesApi, "remove");
  await expect(
    deleteSelection([entry("a"), entry("b", null, "read")], ["a", "b"], task()),
  ).rejects.toThrow("管理权限");
  expect(remove).not.toHaveBeenCalled();
});
it("确认期间切换身份不发请求；处理中切换空间不继续删除剩余项", async () => {
  const scope = { identity: "user", spaceId: "space" };
  const remove = vi.spyOn(filesApi, "remove").mockImplementation(async () => {
    scope.spaceId = "other";
  });
  const operation = createScopedTask(() => ({ ...scope }));
  await expect(
    deleteSelection([entry("a"), entry("b")], ["a", "b"], operation),
  ).rejects.toThrow();
  expect(remove).toHaveBeenCalledTimes(1);
  const second = createScopedTask(() => ({ ...scope }));
  scope.identity = "new-user";
  await expect(deleteSelection([entry("a")], ["a"], second)).rejects.toThrow();
  expect(remove).toHaveBeenCalledTimes(1);
});
