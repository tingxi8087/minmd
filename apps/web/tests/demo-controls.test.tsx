import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import TooltipButton from "../src/components/TooltipButton";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.doUnmock("../src/runtimeMode");
  vi.resetModules();
});
async function runtime(demo: boolean) {
  vi.doMock("../src/runtimeMode", () => ({ isDemo: demo }));
  vi.resetModules();
  return import("../src/runtime");
}
function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}
it("演示保留后端菜单入口，禁用并说明部署后可使用，本地功能仍可用", async () => {
  const { demoMenu } = await runtime(true);
  const items = [
    { key: "share", label: "分享" },
    { key: "import", label: "导入" },
  ];
  const menu = demoMenu(items);
  expect(menu).toHaveLength(2);
  expect(menu[0]).toMatchObject({ disabled: true, title: "部署后可使用" });
  expect(menu[1]).toBe(items[1]);
  expect(items[0]).not.toHaveProperty("disabled");
  expect(render(<>{menu[0].label}</>).textContent).toBe("分享部署后可使用");
});
it.each([false, true])(
  "演示原生/图标按钮不可触发点击或键盘动作：%s",
  async (custom) => {
    const { FullVersion } = await runtime(true);
    const click = vi.fn();
    const Control = custom ? TooltipButton : "button";
    const host = render(
      <FullVersion feature="分享">
        <Control onClick={click}>分享</Control>
      </FullVersion>,
    );
    const button = host.querySelector("button")!;
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-label")).toContain("部署后可使用");
    act(() => button.click());
    for (const key of ["Enter", " "]) {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      act(() => button.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
    }
    expect(click).not.toHaveBeenCalled();
  },
);
it("正式构建保留原菜单与点击行为", async () => {
  const { FullVersion, demoMenu } = await runtime(false);
  const items = [{ key: "share", label: "分享" }];
  expect(demoMenu(items)).toBe(items);
  const click = vi.fn();
  const host = render(
    <FullVersion feature="分享">
      <button onClick={click}>分享</button>
    </FullVersion>,
  );
  act(() => host.querySelector("button")!.click());
  expect(click).toHaveBeenCalledOnce();
  expect(host.querySelector("button")!.hasAttribute("aria-disabled")).toBe(
    false,
  );
});
