import { act } from "react";
import { createRoot } from "react-dom/client";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, expect, it, vi } from "vitest";
import { SelectableCodeBlock } from "../src/views/Document/components/CodeBlock";
import MermaidDiagram from "../src/components/MermaidDiagram";
import { renderMermaid } from "../src/components/MermaidDiagram/render";
vi.mock("../src/components/MermaidDiagram/render", () => ({
  MERMAID_MAX_SOURCE: 50_000,
  renderMermaid: vi.fn(
    async () => '<svg role="img"><text>图表结果</text></svg>',
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("Mermaid 默认图表；切换源码不改变文档，也不触发保存，且只读时仍可切换", async () => {
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  const update = vi.fn();
  let snapshot = "";
  function Probe() {
    const editor = useEditor({
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        SelectableCodeBlock,
      ],
      editable: false,
      content: {
        type: "doc",
        content: [
          {
            type: "codeBlock",
            attrs: { language: "mermaid" },
            content: [{ type: "text", text: "graph TD\nA-->B" }],
          },
        ],
      },
      onUpdate: update,
    });
    snapshot = JSON.stringify(editor?.getJSON());
    return <EditorContent editor={editor} />;
  }
  try {
    await act(async () => root.render(<Probe />));
    const buttons = host.querySelectorAll<HTMLButtonElement>(
      "button[aria-pressed]",
    );
    expect(buttons[0].textContent).toBe("图表");
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[aria-label="代码块语言"]')).toBeNull();
    const original = snapshot;
    await act(async () => buttons[1].click());
    expect(buttons[1].getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("pre")?.textContent).toBe("graph TD\nA-->B");
    await act(async () => buttons[0].click());
    expect(snapshot).toBe(original);
    expect(update).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
it("快速输入防抖，只渲染最新源码；渲染错误显示提示", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () =>
      root.render(<MermaidDiagram source="graph TD; A-->B" />),
    );
    await act(async () => vi.advanceTimersByTimeAsync(200));
    await act(async () =>
      root.render(<MermaidDiagram source="graph TD; A-->C" />),
    );
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(renderMermaid).toHaveBeenCalledTimes(1);
    expect(vi.mocked(renderMermaid).mock.calls[0][0]).toBe("graph TD; A-->C");
    expect(host.querySelector('svg[role="img"]')?.textContent).toBe("图表结果");
    vi.mocked(renderMermaid).mockRejectedValueOnce(new Error("invalid syntax"));
    await act(async () => root.render(<MermaidDiagram source="invalid" />));
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "检查 Mermaid 语法",
    );
  } finally {
    await act(async () => root.unmount());
  }
});

it("过期渲染不能覆盖新源码结果，卸载时中止请求", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div"),
    root = createRoot(host);
  let finishOld: (svg: string) => void = () => {};
  vi.mocked(renderMermaid).mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finishOld = resolve;
      }),
  );
  try {
    await act(async () => root.render(<MermaidDiagram source="old" />));
    await act(async () => vi.advanceTimersByTimeAsync(300));
    const oldSignal = vi.mocked(renderMermaid).mock.calls[0][2];
    await act(async () => root.render(<MermaidDiagram source="new" />));
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(300));
    await act(async () => finishOld("<svg><text>过期图表</text></svg>"));
    expect(host.querySelector('svg[role="img"]')?.textContent).toBe("图表结果");
  } finally {
    await act(async () => root.unmount());
  }
  expect(vi.mocked(renderMermaid).mock.calls.at(-1)?.[2]?.aborted).toBe(true);
});
