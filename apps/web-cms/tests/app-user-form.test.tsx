import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import UserFormDrawer, { type UserFormRef, type UserFormEvent } from "../src/views/AppUsers/components/UserFormDrawer";
import type { AppUser } from "../src/http/services/appUsers";
vi.mock("../src/views/AppUsers/components/AvatarUpload", () => ({ default: () => <input aria-label="头像测试" /> }));
Object.defineProperty(window, "matchMedia", { writable: true, value: () => ({ matches: false, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) });
const enter = async (selector: string, value: string) => {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
it("新建默认勾选、取消后提交false，再次打开恢复勾选；编辑不提交建空间字段", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"), root = createRoot(host), ref = createRef<UserFormRef>();
  document.body.append(host);
  const save = vi.fn(async (_event: UserFormEvent) => {});
  const clickSave = async () => act(async () => {
    const button = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.replaceAll(" ", "") === "保存")!;
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  try {
    await act(async () => root.render(<UserFormDrawer ref={ref} />));
    await act(async () => ref.current!.open({ onEvent: save }));
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    await enter("#account", "new_user"); await enter("#password", "123456");
    await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await clickSave();
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ type: "save", values: expect.objectContaining({ createDefaultSpace: false }) }));
    await act(async () => ref.current!.open({ onEvent: save }));
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    await act(async () => ref.current!.open({ onEvent: save, user: { id: "fixture", account: "existing", nickname: "昵称", avatar: "", metadata: { saved: true }, roles: ["existing-role"] } as AppUser }));
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    await clickSave();
    const event = save.mock.calls.at(-1)![0];
    expect(event).toMatchObject({ type: "save", id: "fixture", values: { metadata: { saved: true }, roles: ["existing-role"] } });
    if (event.type === "save") expect(event.values).not.toHaveProperty("createDefaultSpace");
  } finally { act(() => root.unmount()); host.remove(); }
});
