import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { UserInput } from "@/mock/userModel";
let api: typeof import("@/mock/mock");
beforeEach(async () => { vi.useFakeTimers(); vi.resetModules(); api = await import("@/mock/mock"); });
afterEach(() => vi.useRealTimers());
async function done<T>(promise: Promise<T>) { const pending = promise.then(value => ({ value }), error => ({ error })); await vi.runAllTimersAsync(); const result = await pending; if ("error" in result) throw result.error; return result.value; }
const input: UserInput = { name: "新用户", account: "new_user", age: 27, gender: "private", phone: "13900000000", email: "new@example.com", department: "engineering", roles: ["editor", "viewer"], status: "enabled", birthday: "1999-01-01", hobbies: ["音乐"], notifications: false, des: "" };
it("组合筛选、多选角色、日期和年龄边界均实际生效", async () => {
  const { data } = await done(api.getStudentHttp({ name: "小红", account: "user002", status: "enabled", department: "engineering", roles: ["admin", "editor"], ageRange: { leftValue: 21, rightValue: 21 }, registered: ["2026-02-02", "2026-02-02"] }));
  expect(data.list.map(row => row.id)).toEqual([2]);
  expect((await done(api.getStudentHttp({ id: 2, registered: ["2026-02-03", "2026-03-01"] }))).data.total).toBe(0);
  expect((await done(api.getStudentHttp({ id: 2, roles: ["viewer"] }))).data.total).toBe(0);
});
it("新增、编辑清空可选字段，重复账号拒绝且不丢数据", async () => {
  await done(api.addStudentHttp(input));
  const row = (await done(api.getStudentHttp({ account: input.account }))).data.list[0];
  await done(api.setStudentHttp({ ...row, des: "", hobbies: [], birthday: undefined, notifications: false }));
  expect((await done(api.getStudentHttp({ id: row.id }))).data.list[0]).toMatchObject({ des: "", hobbies: [], notifications: false });
  await expect(done(api.addStudentHttp(input))).rejects.toThrow("账号已存在");
  expect((await done(api.getStudentHttp({ account: input.account }))).data.total).toBe(1);
});
it("批量状态、查询返回隔离与删除后的页码校正", async () => {
  const result = await done(api.getStudentHttp({ pageSize: 5, pageNum: 6 }));
  result.data.list[0].roles.push("not-real");
  expect((await done(api.getStudentHttp({ id: 26 }))).data.list[0].roles).not.toContain("not-real");
  await done(api.setStudentStatusHttp([1, 2], "disabled"));
  expect((await done(api.getStudentHttp({ id: 2 }))).data.list[0].status).toBe("disabled");
  for (const row of result.data.list) await done(api.delStudentHttp(row.id));
  expect((await done(api.getStudentHttp({ pageNum: 6, pageSize: 5 }))).data.pageNum).toBe(5);
});

it("图表汇总读取全部用户并反映状态修改，趋势范围正确", async () => {
  for (let index = 0; index < 22; index++) await done(api.addStudentHttp({ ...input, account: `chart_user_${index}` }));
  await done(api.setStudentStatusHttp([1, 2], "disabled"));
  const { getChartData } = await import("@/mock/charts");
  const data = await done(getChartData(30));
  expect(data.total).toBe(51);
  expect(data.departments.reduce((sum, row) => sum + row.value, 0)).toBe(51);
  expect(data.statuses.reduce((sum, row) => sum + row.value, 0)).toBe(51);
  expect(data.roles.reduce((sum, role) => sum + role.values.reduce((a, b) => a + b, 0), 0)).toBe(73);
  expect(data.trend).toHaveLength(30);
});
