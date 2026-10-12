import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useDocumentTitle } from "../src/views/Document/useDocumentTitle";
function Probe({ name }: { name: string }) {
  const [title, setTitle] = useDocumentTitle(name);
  return (
    <>
      <input
        aria-label="文档标题"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <span>{title}</span>
    </>
  );
}
it("打开的文档同步外部重命名；未提交的输入保留，保存回显后再次重命名仍同步", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"),
    root = createRoot(host);
  const render = async (name: string) =>
    act(async () => root.render(<Probe name={name} />));
  try {
    await render("原名");
    await render("左侧重命名");
    expect(host.querySelector("input")!.value).toBe("左侧重命名");
    const input = host.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "正在输入");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await render("另一处重命名");
    expect(input.value).toBe("正在输入");
    await render("正在输入");
    await render("再次从左侧修改");
    expect(input.value).toBe("再次从左侧修改");
    expect(host.querySelector("span")!.textContent).toBe("再次从左侧修改");
  } finally {
    act(() => root.unmount());
  }
});
