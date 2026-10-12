import { expect, test } from "bun:test";
import { resolvePermission } from "../apps/app_server/src/modules/file-access/policy";
const base = {
  manager: false,
  member: false,
  memberPermission: "read" as const,
};
test("私有文件只允许成员与指定账号，外部授权不会变成空间成员", () => {
  expect(resolvePermission(base)).toBeNull();
  expect(resolvePermission({ ...base, member: true })).toBe("read");
  expect(resolvePermission({ ...base, grant: "edit" })).toBe("edit");
  expect(resolvePermission({ ...base, manager: true })).toBe("manage");
});
test("成员显式只读可以覆盖空间默认编辑；公开编辑是额外授权", () => {
  expect(
    resolvePermission({
      ...base,
      member: true,
      memberPermission: "edit",
      grant: "read",
    }),
  ).toBe("read");
  expect(resolvePermission({ ...base, member: true, grant: "edit" })).toBe(
    "edit",
  );
  expect(
    resolvePermission({ ...base, grant: "read", publicPermission: "edit" }),
  ).toBe("edit");
  expect(
    resolvePermission({ ...base, grant: "edit", publicPermission: "read" }),
  ).toBe("edit");
});
