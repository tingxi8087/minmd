import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";
import { headingSections } from "./headingSections";

export const collapseKey = new PluginKey<Set<string>>(
  "personalHeadingCollapse",
);
const headingKey = (node: { attrs: Record<string, unknown> }, pos: number) =>
  typeof node.attrs.blockId === "string"
    ? node.attrs.blockId
    : `position-${pos}`;
export function revealHeading(editor: Editor, pos: number) {
  const collapsed = new Set(collapseKey.getState(editor.state) ?? []);
  for (const section of headingSections(editor.state.doc)) {
    if (pos >= section.contentFrom && pos < section.contentTo) {
      const node = editor.state.doc.nodeAt(section.pos);
      if (node) collapsed.delete(headingKey(node, section.pos));
    }
  }
  const tr = editor.state.tr.setMeta(collapseKey, collapsed);
  tr.setSelection(
    TextSelection.create(tr.doc, Math.min(pos + 1, tr.doc.content.size)),
  );
  editor.view.dispatch(tr);
}
export function createHeadingCollapsePlugin(storageKey: string) {
  const read = () => {
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem(storageKey) ?? "[]",
      );
      return new Set(
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string")
          : [],
      );
    } catch {
      return new Set<string>();
    }
  };
  return new Plugin<Set<string>>({
    key: collapseKey,
    state: {
      init: read,
      apply(tr, previous) {
        const value: unknown = tr.getMeta(collapseKey);
        if (!(value instanceof Set)) return previous;
        const next = new Set(
          [...value].filter((item): item is string => typeof item === "string"),
        );
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, JSON.stringify([...next]));
          } catch {
            /* 折叠偏好失败不影响内容。 */
          }
        }
        return next;
      },
    },
    appendTransaction(transactions, _oldState, state) {
      if (!transactions.some((tr) => tr.selectionSet)) return null;
      const ancestors = headingSections(state.doc).filter(
        (section) =>
          collapseKey
            .getState(state)
            ?.has(headingKey(state.doc.nodeAt(section.pos)!, section.pos)) &&
          state.selection.from >= section.contentFrom &&
          state.selection.from < section.contentTo,
      );
      if (!ancestors.length) return null;
      const collapsed = new Set(collapseKey.getState(state) ?? []);
      for (const section of ancestors)
        collapsed.delete(
          headingKey(state.doc.nodeAt(section.pos)!, section.pos),
        );
      const tr = state.tr.setMeta(collapseKey, collapsed);
      return tr;
    },
    props: {
      decorations(state) {
        const sections = headingSections(state.doc).map((section) => ({
          ...section,
          collapsed:
            collapseKey
              .getState(state)
              ?.has(headingKey(state.doc.nodeAt(section.pos)!, section.pos)) ??
            false,
        }));
        const decorations: Decoration[] = [];
        const hidden = sections.filter((s) => s.collapsed);
        state.doc.descendants((node, pos) => {
          if (hidden.some((s) => pos >= s.contentFrom && pos < s.contentTo)) {
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, {
                class: "heading-section-hidden",
              }),
            );
            return false;
          }
        });
        for (const section of sections) {
          const heading = state.doc.nodeAt(section.pos)!;
          decorations.push(
            Decoration.node(section.pos, section.pos + heading.nodeSize, {
              class: `collapsible-heading ${section.collapsed ? "heading-collapsed" : ""}`,
            }),
          );
          decorations.push(
            Decoration.widget(
              section.pos + 1,
              (view) => {
                const button = document.createElement("button");
                button.className = "heading-toggle";
                button.contentEditable = "false";
                button.type = "button";
                button.setAttribute(
                  "aria-label",
                  `${section.collapsed ? "展开" : "折叠"}章节 ${heading.textContent || "未命名标题"}`,
                );
                button.setAttribute(
                  "aria-expanded",
                  String(!section.collapsed),
                );
                button.innerHTML =
                  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
                button.onmousedown = (event) => event.preventDefault();
                button.onclick = (event) => {
                  event.preventDefault();
                  const node = view.state.doc.nodeAt(section.pos);
                  if (node?.type.name !== "heading") return;
                  const key = headingKey(node, section.pos);
                  const collapsed = new Set(
                    collapseKey.getState(view.state) ?? [],
                  );
                  const closing = !collapsed.has(key);
                  if (closing) collapsed.add(key);
                  else collapsed.delete(key);
                  const tr = view.state.tr.setMeta(collapseKey, collapsed);
                  if (
                    closing &&
                    view.state.selection.to > section.contentFrom &&
                    view.state.selection.from < section.contentTo
                  )
                    tr.setSelection(
                      TextSelection.create(
                        tr.doc,
                        section.pos + node.nodeSize - 1,
                      ),
                    );
                  view.dispatch(tr);
                };
                return button;
              },
              { side: -1, stopEvent: () => true },
            ),
          );
        }
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}
export const HeadingCollapse = Extension.create<{ storageKey: string }>({
  name: "headingCollapse",
  addOptions: () => ({ storageKey: "" }),
  addProseMirrorPlugins() {
    return [createHeadingCollapsePlugin(this.options.storageKey)];
  },
});
