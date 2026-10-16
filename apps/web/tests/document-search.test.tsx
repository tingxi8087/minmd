import { afterEach, describe, expect, it } from "vitest";
import { Editor, Node as TiptapNode } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import Collaboration from "@tiptap/extension-collaboration";
import { yUndoPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import FindReplace, {
  type SearchPanelMode,
} from "../src/views/Document/components/FindReplace";
import {
  DocumentSearch,
  findDocumentMatches,
  replaceDocumentMatches,
  revealSearchMatch,
  searchState,
  updateDocumentSearch,
} from "../src/views/Document/extensions/documentSearch";
import {
  collapseKey,
  HeadingCollapse,
} from "../src/views/Document/extensions/headingCollapse";

const editors: Editor[] = [];
function makeEditor(
  options: Partial<ConstructorParameters<typeof Editor>[0]> = {},
) {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit, TableKit, HeadingCollapse, DocumentSearch],
    content: "<p>alpha Alpha</p>",
    ...options,
  });
  editors.push(editor);
  return editor;
}
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("文档查找事务", () => {
  it("跨样式搜同一段文字，包含标题列表表格代码，不跨段/换行/原子节点且按字面匹配", () => {
    const editor = makeEditor({
      content:
        "<h2>标题 needle</h2><p>nee<strong>dle</strong> a+b [x]</p><ul><li><p>needle</p></li></ul><table><tr><td><p>needle</p></td></tr></table><pre><code>needle\nline</code></pre><p>nee</p><p>dle</p><p>nee<br>dle</p>",
    });
    expect(findDocumentMatches(editor.state.doc, "needle", false)).toHaveLength(
      5,
    );
    expect(findDocumentMatches(editor.state.doc, "a+b", false)).toHaveLength(1);
    expect(findDocumentMatches(editor.state.doc, "[x]", false)).toHaveLength(1);
    expect(
      findDocumentMatches(editor.state.doc, "nee\ndle", false),
    ).toHaveLength(0);
    expect(
      findDocumentMatches(editor.state.doc, "needle\nline", false),
    ).toHaveLength(1);
  });
  it("Unicode大小写搜索不改变源文档位置，查找状态不进入JSON", () => {
    const editor = makeEditor({ content: "<p>İ S s K k 中文中文</p>" });
    const before = editor.getJSON();
    updateDocumentSearch(editor, { query: "s" });
    expect(searchState(editor).matches).toHaveLength(2);
    updateDocumentSearch(editor, { caseSensitive: true });
    expect(searchState(editor).matches).toHaveLength(1);
    updateDocumentSearch(editor, { query: "中文" });
    expect(searchState(editor).matches).toHaveLength(2);
    expect(editor.getJSON()).toEqual(before);
    expect(
      editor.view.dom.querySelectorAll(".document-search-current"),
    ).toHaveLength(1);
    updateDocumentSearch(editor, { query: "" });
    expect(
      editor.view.dom.querySelectorAll(".document-search-match"),
    ).toHaveLength(0);
  });
  it("远端或本机内容变化后重算匹配，索引仍有效，替换不使用过期范围", () => {
    const editor = makeEditor();
    updateDocumentSearch(editor, { query: "alpha", active: 1 });
    updateDocumentSearch(editor, { active: 1 });
    const initial = searchState(editor).matches;
    editor.commands.insertContentAt(1, "new ");
    expect(searchState(editor).active).toBe(1);
    expect(searchState(editor).matches[1].from).toBe(initial[1].from + 4);
    expect(replaceDocumentMatches(editor, "done", false)).toBe(1);
    expect(editor.getText()).toBe("new alpha done");
    expect(searchState(editor).matches).toHaveLength(1);
  });
  it("全部替换保留命中起点样式、段落及周围样式，替换和后续输入分别撤销", () => {
    const editor = makeEditor({
      content: "<p><strong>ab</strong><em>cd</em> abcd</p><h2>abcd</h2><p></p>",
    });
    updateDocumentSearch(editor, { query: "abcd" });
    expect(replaceDocumentMatches(editor, "替代", true)).toBe(3);
    expect(editor.getHTML()).toBe(
      "<p><strong>替代</strong> 替代</p><h2>替代</h2><p></p>",
    );
    editor.commands.insertContentAt(1, "later ");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).not.toContain("later");
    expect(editor.getText()).toContain("替代");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getHTML()).toBe(
      "<p><strong>ab</strong><em>cd</em> abcd</p><h2>abcd</h2><p></p>",
    );
  });
  it("空替换删除命中，只读禁止事务，导航能展开折叠章节而不改变JSON", () => {
    const editor = makeEditor({
      content: "<h2>章</h2><p>needle</p><h2>后章</h2><p>end</p>",
    });
    editor.view.dispatch(
      editor.state.tr.setMeta(collapseKey, new Set(["position-0"])),
    );
    const before = editor.getJSON();
    updateDocumentSearch(editor, { query: "needle" });
    revealSearchMatch(editor);
    expect(collapseKey.getState(editor.state)?.size).toBe(0);
    expect(editor.getJSON()).toEqual(before);
    editor.setEditable(false);
    expect(replaceDocumentMatches(editor, "hidden", true)).toBe(0);
    expect(editor.getJSON()).toEqual(before);
    editor.setEditable(true);
    expect(replaceDocumentMatches(editor, "", true)).toBe(1);
    expect(editor.getText()).not.toContain("needle");
  });
  it("定位折叠块中的命中仅改变本机可见状态，原折叠属性保留", () => {
    const localFold = TiptapNode.create({
      name: "fold",
      group: "block",
      content: "block+",
      addAttributes: () => ({ open: { default: false } }),
      parseHTML: () => [{ tag: "section[data-fold]" }],
      renderHTML: () => [
        "section",
        { class: "doc-fold", "data-fold": "" },
        ["div", { hidden: "hidden" }, 0],
      ],
    });
    const editor = makeEditor({
      extensions: [StarterKit, DocumentSearch, localFold],
      // Mirror the initialized editor: StarterKit keeps a trailing paragraph.
      content: "<section data-fold><p>hidden match</p></section><p></p>",
    });
    const before = editor.getJSON();
    updateDocumentSearch(editor, { query: "hidden" });
    revealSearchMatch(editor);
    expect(
      editor.view.dom
        .querySelector(".doc-fold")
        ?.getAttribute("data-search-reveal"),
    ).toBe("true");
    expect(editor.getJSON()).toEqual(before);
    expect(editor.getJSON().content?.[0].attrs?.open).toBe(false);
  });
  it("相同词替换不会循环，非重叠匹配与长度变化准确", () => {
    const editor = makeEditor({ content: "<p>aaaa aa</p>" });
    updateDocumentSearch(editor, { query: "aa" });
    expect(replaceDocumentMatches(editor, "aa", true)).toBe(3);
    expect(editor.getText()).toBe("aaaa aa");
    expect(replaceDocumentMatches(editor, "长文本", true)).toBe(3);
    expect(editor.getText()).toBe("长文本长文本 长文本");
  });
  it("Yjs两份编辑器同步替换，全部替换一次撤销且不撤销对方的并发编辑", () => {
    const a = new Y.Doc(),
      b = new Y.Doc();
    const forward = (update: Uint8Array, origin: unknown) => {
      if (origin !== b) Y.applyUpdate(b, update, a);
    };
    const backward = (update: Uint8Array, origin: unknown) => {
      if (origin !== a) Y.applyUpdate(a, update, b);
    };
    a.on("update", forward);
    b.on("update", backward);
    const editorA = makeEditor({
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        DocumentSearch,
        Collaboration.configure({ document: a }),
      ],
      content: undefined,
    });
    const editorB = makeEditor({
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        DocumentSearch,
        Collaboration.configure({ document: b }),
      ],
      content: undefined,
    });
    try {
      editorA.commands.setContent("<p>alpha alpha</p>");
      yUndoPluginKey.getState(editorA.state).undoManager.clear();
      yUndoPluginKey.getState(editorB.state).undoManager.clear();
      updateDocumentSearch(editorA, { query: "alpha" });
      expect(searchState(editorB).query).toBe("");
      expect(replaceDocumentMatches(editorA, "beta", true)).toBe(2);
      expect(editorB.getText()).toBe("beta beta");
      editorB.commands.insertContentAt(
        editorB.state.doc.content.size - 1,
        " remote",
      );
      expect(editorA.getText()).toBe("beta beta remote");
      expect(editorA.commands.undo()).toBe(true);
      expect(editorA.getText()).toBe("alpha alpha remote");
      expect(editorB.getText()).toBe("alpha alpha remote");
    } finally {
      a.off("update", forward);
      b.off("update", backward);
      editorA.destroy();
      editorB.destroy();
      a.destroy();
      b.destroy();
    }
  });
});

function Probe({
  editor,
  readonly = false,
}: {
  editor: Editor;
  readonly?: boolean;
}) {
  const [mode, setMode] = useState<SearchPanelMode>(null);
  return (
    <FindReplace
      editor={editor}
      mode={mode}
      onModeChange={setMode}
      readonly={readonly}
    />
  );
}
it("浮层快捷键、输入法、Esc及只读/权限变化边界", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const editor = makeEditor();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const key = (key: string, options: KeyboardEventInit = {}) =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );
  try {
    await act(async () => root.render(<Probe editor={editor} />));
    await act(async () => {
      key("f");
    });
    expect(host.querySelector('[role="search"]')).not.toBeNull();
    const input = host.querySelector<HTMLInputElement>(
      '[aria-label="查找内容"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "alpha");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector('[aria-label="匹配数量"]')?.textContent).toBe(
      "1 / 2",
    );
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          isComposing: true,
        }),
      );
    });
    expect(searchState(editor).active).toBe(0);
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(searchState(editor).active).toBe(1);
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(host.querySelector('[role="search"]')).toBeNull();
    expect(searchState(editor).matches).toHaveLength(0);
    await act(async () => {
      key("h", { shiftKey: true, metaKey: true, ctrlKey: false });
    });
    expect(host.querySelector('[aria-label="替换为"]')).not.toBeNull();
    await act(async () => {
      editor.setEditable(false);
    });
    expect(host.querySelector('[aria-label="替换为"]')).toBeNull();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    Object.defineProperty(dialog, "getClientRects", {
      value: () => [new DOMRect(0, 0, 100, 100)],
    });
    document.body.append(dialog);
    await act(async () => {
      host
        .querySelector('[aria-label="查找内容"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    });
    await act(async () => {
      key("f");
    });
    expect(host.querySelector('[role="search"]')).toBeNull();
    dialog.remove();
    await act(async () => root.render(<Probe editor={editor} readonly />));
    await act(async () => {
      key("h", { shiftKey: true });
    });
    expect(host.querySelector('[aria-label="查找内容"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="替换为"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
