import { act } from "react";
import { createRoot } from "react-dom/client";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, expect, it, vi } from "vitest";
import DiagramCanvas from "../src/components/MermaidDiagram/DiagramCanvas";
import { SelectableCodeBlock } from "../src/views/Document/components/CodeBlock";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
afterEach(() => {
  vi.restoreAllMocks();
});
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" id="graph" viewBox="0 0 400 200"><defs><marker id="arrow"/></defs><style>#graph .edge{marker-end:url(#arrow)}</style><path class="edge" marker-end="url(#arrow)"/></svg>';
it("缩放、适应窗口与全屏入口；两个画布中的 SVG ID 和箭头引用互不干扰", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(320);
  const host = document.createElement("div"),
    root = createRoot(host),
    expand = vi.fn();
  try {
    await act(async () =>
      root.render(
        <>
          <DiagramCanvas svg={svg} onExpand={expand} />
          <DiagramCanvas svg={svg} fullscreen />
        </>,
      ),
    );
    const preview = host.querySelector('[aria-label="图表预览工具"]')!;
    const output = preview.querySelector("output")!;
    expect(output.textContent).toBe("100%");
    await act(async () =>
      (
        preview.querySelector('[aria-label="放大图表"]') as HTMLButtonElement
      ).click(),
    );
    expect(output.textContent).toBe("125%");
    for (let step = 0; step < 20; step++) {
      await act(async () =>
        (
          preview.querySelector('[aria-label="放大图表"]') as HTMLButtonElement
        ).click(),
      );
    }
    expect(output.textContent).toBe("400%");
    expect(
      (preview.querySelector('[aria-label="放大图表"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await act(async () =>
      (
        preview.querySelector('[aria-label="适应预览"]') as HTMLButtonElement
      ).click(),
    );
    expect(output.textContent).toBe("100%");
    await act(async () =>
      (
        preview.querySelector(
          '[aria-label="全屏查看图表"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(expand).toHaveBeenCalledTimes(1);
    const graphs = host.querySelectorAll("svg[id]");
    expect(graphs[0].id).not.toBe(graphs[1].id);
    for (const graph of graphs) {
      const marker = graph.querySelector("marker")!.id;
      expect(graph.querySelector("path")!.getAttribute("marker-end")).toBe(
        `url(#${marker})`,
      );
      expect(graph.querySelector("style")!.textContent).toContain(
        `#${graph.id}`,
      );
    }
  } finally {
    await act(async () => root.unmount());
  }
});
it.each(["javascript", "mermaid"])(
  "%s 代码块可删除并撤销；只读时隐藏删除按钮",
  async (language) => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addListener() {},
      removeListener() {},
    }));
    const host = document.createElement("div"),
      root = createRoot(host);
    let editor: Editor | null = null;
    function Probe() {
      const value = useEditor({
        extensions: [
          StarterKit.configure({ codeBlock: false }),
          SelectableCodeBlock,
        ],
        content: {
          type: "doc",
          content: [
            {
              type: "codeBlock",
              attrs: { language },
              content: [{ type: "text", text: "graph TD;A-->B" }],
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "保留正文" }],
            },
          ],
        },
      });
      editor = value;
      return <EditorContent editor={value} />;
    }
    try {
      await act(async () => root.render(<Probe />));
      const current = editor! as Editor;
      const original = current.getJSON();
      await act(async () =>
        (
          host.querySelector('[aria-label="删除代码块"]') as HTMLButtonElement
        ).click(),
      );
      expect(
        current.getJSON().content?.some((node) => node.type === "codeBlock"),
      ).toBe(false);
      expect(current.getText()).toContain("保留正文");
      await act(async () => {
        current.commands.undo();
      });
      expect(current.getJSON()).toEqual(original);
      await act(async () => current.setEditable(false));
      expect(host.querySelector('[aria-label="删除代码块"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  },
);

it("全屏滚轮按纵横轴移动，支持 Shift 和行/页单位；内嵌预览不拦截正文滚动", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(320);
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <>
          <DiagramCanvas svg={svg} />
          <DiagramCanvas svg={svg} fullscreen />
        </>,
      ),
    );
    const full = host.querySelector('[aria-label="全屏图表画布"]')!;
    const inline = host.querySelector('[aria-label="图表预览画布"]')!;
    const position = full.firstElementChild as HTMLElement;
    const wheel = async (element: Element, init: WheelEventInit) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      await act(async () => {
        element.dispatchEvent(event);
      });
      return event;
    };
    expect((await wheel(full, { deltaY: 80 })).defaultPrevented).toBe(true);
    expect(position.style.transform).toBe("translate(0px, -80px)");
    await wheel(full, { deltaX: 35, deltaY: -20 });
    expect(position.style.transform).toBe("translate(-35px, -60px)");
    await wheel(full, { shiftKey: true, deltaY: 50 });
    expect(position.style.transform).toBe("translate(-85px, -60px)");
    await wheel(full, { shiftKey: true, deltaX: 25 });
    expect(position.style.transform).toBe("translate(-110px, -60px)");
    await wheel(full, { deltaY: 2, deltaMode: 1 });
    expect(position.style.transform).toBe("translate(-110px, -92px)");
    await wheel(full, { deltaX: 1, deltaY: 1, deltaMode: 2 });
    expect(position.style.transform).toBe("translate(-910px, -412px)");
    expect((await wheel(inline, { deltaY: 100 })).defaultPrevented).toBe(false);
    expect((inline.firstElementChild as HTMLElement).style.transform).toBe(
      "translate(0px, 0px)",
    );
    expect(
      (await wheel(full, { metaKey: true, deltaY: 100 })).defaultPrevented,
    ).toBe(false);
    expect(position.style.transform).toBe("translate(-910px, -412px)");
    const tools = host.querySelector('[aria-label="全屏图表工具"]')!;
    expect(tools.querySelector("output")!.textContent).toBe("100%");
    await act(async () =>
      (
        tools.querySelector('[aria-label="适应窗口"]') as HTMLButtonElement
      ).click(),
    );
    expect(position.style.transform).toBe("translate(0px, 0px)");
  } finally {
    await act(async () => root.unmount());
  }
});

it("全屏键盘加减缩放支持 Mac 的 =、Shift+= 和数字键盘，不劫持输入或浏览器快捷键", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(320);
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () =>
      root.render(
        <div role="dialog">
          <DiagramCanvas svg={svg} fullscreen />
          <input aria-label="输入" />
        </div>,
      ),
    );
    const dialog = host.querySelector('[role="dialog"]')!;
    const output = host.querySelector("output")!;
    const key = async (target: Element, init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      await act(async () => {
        target.dispatchEvent(event);
      });
      return event;
    };
    expect(
      (await key(dialog, { key: "=", code: "Equal" })).defaultPrevented,
    ).toBe(true);
    expect(output.textContent).toBe("125%");
    await key(dialog, { key: "+", code: "Equal", shiftKey: true });
    expect(output.textContent).toBe("156%");
    await key(dialog, { key: "-", code: "Minus" });
    expect(output.textContent).toBe("125%");
    await key(dialog, { key: "+", code: "NumpadAdd" });
    await key(dialog, { key: "-", code: "NumpadSubtract" });
    expect(output.textContent).toBe("125%");
    expect(
      (await key(dialog, { key: "=", metaKey: true })).defaultPrevented,
    ).toBe(false);
    expect(
      (await key(dialog, { key: "-", ctrlKey: true })).defaultPrevented,
    ).toBe(false);
    expect(
      (await key(host.querySelector("input")!, { key: "=" })).defaultPrevented,
    ).toBe(false);
    expect(output.textContent).toBe("125%");
    await act(async () => root.render(<DiagramCanvas svg={svg} />));
    expect((await key(document.body, { key: "=" })).defaultPrevented).toBe(
      false,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("全屏捏合围绕指针缩放，反向手势恢复位置，内嵌预览不拦截捏合", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(100, 50, 800, 320),
  );
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <>
          <DiagramCanvas svg={svg} />
          <DiagramCanvas svg={svg} fullscreen />
        </>,
      ),
    );
    const full = host.querySelector('[aria-label="全屏图表画布"]')!;
    const inline = host.querySelector('[aria-label="图表预览画布"]')!;
    const output = host.querySelector('[aria-label="全屏图表工具"] output')!;
    const pinch = (target: Element, deltaY: number) => {
      const event = new WheelEvent("wheel", {
        ctrlKey: true,
        clientX: 700,
        clientY: 210,
        deltaY,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        target.dispatchEvent(event);
      });
      return event;
    };
    expect(pinch(full, -Math.log(2) * 100).defaultPrevented).toBe(true);
    expect(output.textContent).toBe("200%");
    expect((full.firstElementChild as HTMLElement).style.transform).toBe(
      "translate(-200px, 0px)",
    );
    pinch(full, Math.log(2) * 100);
    expect(output.textContent).toBe("100%");
    expect((full.firstElementChild as HTMLElement).style.transform).toBe(
      "translate(0px, 0px)",
    );
    expect(pinch(inline, -50).defaultPrevented).toBe(false);
  } finally {
    await act(async () => root.unmount());
  }
});
it("Safari 累积手势按比例缩放，重复 Ctrl+wheel 及尾部事件不叠加，卸载后释放监听", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(320);
  let time = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => time);
  const host = document.createElement("div"),
    root = createRoot(host);
  let full: Element;
  try {
    await act(async () => root.render(<DiagramCanvas svg={svg} fullscreen />));
    full = host.querySelector('[aria-label="全屏图表画布"]')!;
    const output = host.querySelector("output")!;
    const gesture = (type: string, scale = 1) => {
      const event = Object.assign(
        new Event(type, { bubbles: true, cancelable: true }),
        { scale, clientX: 0, clientY: 0 },
      );
      act(() => {
        full.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(true);
    };
    const wheel = () => {
      const event = new WheelEvent("wheel", {
        ctrlKey: true,
        deltaY: -Math.log(2) * 100,
        cancelable: true,
      });
      act(() => {
        full.dispatchEvent(event);
      });
      return event;
    };
    gesture("gesturestart");
    gesture("gesturechange", 2);
    expect(output.textContent).toBe("200%");
    wheel();
    expect(output.textContent).toBe("200%");
    gesture("gesturechange", 3);
    expect(output.textContent).toBe("300%");
    gesture("gesturechange", Number.NaN);
    expect(output.textContent).toBe("300%");
    gesture("gestureend", 3);
    wheel();
    expect(output.textContent).toBe("300%");
    time += 121;
    wheel();
    expect(output.textContent).toBe("400%");
    await act(async () => root.unmount());
    expect(wheel().defaultPrevented).toBe(false);
  } finally {
    if (host.querySelector("output")) await act(async () => root.unmount());
  }
});
