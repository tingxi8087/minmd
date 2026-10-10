import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { accessStore } from "@/store/sys";
import { setCurrentAdmin } from "@/http/authSession";
import RoleManage from "@/views/RoleManage";
vi.mock("@/http/services/management", () => ({
  getRoles: async () => ({items: [{id: "role-1", code: "reader", name: "只读运维", description: "", permissions: ["role:read"], members: 0}], total: 1}),
  getPermissionGroups: async () => ({groups: [{code: "role", name: "角色管理", permissions: [{code: "role:read", name: "查看角色", description: "", write: false}]}]}),
  saveRole: vi.fn(), deleteRole: vi.fn(),
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => computedStyle(element));
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "matchMedia", {configurable: true, value: () => ({matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}})});
  vi.stubGlobal("ResizeObserver", class {observe() {} unobserve() {} disconnect() {}});
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  setCurrentAdmin({id: "reader", account: "reader", displayName: "Reader", isSuperAdmin: false, permissions: ["role:read"]});
});
afterEach(() => {act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals();});
const buttons = () => [...container.querySelectorAll("button")].map(button => button.textContent?.replace(/\s/g, ""));
test("read-only role page shows data but hides mutation buttons; permission changes update controls", async () => {
  await act(async () => root.render(createElement(RoleManage)));
  await act(async () => {await vi.advanceTimersByTimeAsync(250);});
  expect(container.textContent).toContain("只读运维");
  expect(buttons()).not.toContain("添加角色"); expect(buttons()).not.toContain("编辑"); expect(buttons()).not.toContain("删除");
  act(() => {accessStore.list = ["role:read", "role:update"];});
  expect(buttons()).toContain("添加角色"); expect(buttons()).toContain("编辑");
  expect([...container.querySelectorAll("button")].find(button => button.textContent?.includes("添加角色"))?.disabled).toBe(false);
  act(() => {accessStore.list = ["role:read"];});
  expect(buttons()).not.toContain("添加角色"); expect(buttons()).not.toContain("编辑");
});
