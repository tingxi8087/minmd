import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";
import { headingSections } from "./headingSections";

export function revealHeading(editor: Editor, pos: number) {
  const tr = editor.state.tr;
  for (const section of headingSections(editor.state.doc)) {
    if (
      section.collapsed &&
      pos >= section.contentFrom &&
      pos < section.contentTo
    ) {
      const node = tr.doc.nodeAt(section.pos)!;
      tr.setNodeMarkup(section.pos, undefined, {
        ...node.attrs,
        collapsed: false,
      });
    }
  }
  // Also reveal headings within explicit fold blocks when jumping from the outline.
  const resolved = tr.doc.resolve(pos);
  for (let depth = 1; depth <= resolved.depth; depth++) {
    if (
      resolved.node(depth).type.name === "fold" &&
      !resolved.node(depth).attrs.open
    )
      tr.setNodeMarkup(resolved.before(depth), undefined, {
        ...resolved.node(depth).attrs,
        open: true,
      });
  }
  tr.setSelection(TextSelection.create(tr.doc, pos + 1));
  editor.view.dispatch(tr);
}
export const HeadingCollapse = Extension.create({
  name: "headingCollapse",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: { collapsed: { default: false, rendered: false } },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, state) {
          if (!transactions.some((tr) => tr.selectionSet)) return null;
          const ancestors = headingSections(state.doc).filter(
            (section) =>
              section.collapsed &&
              state.selection.from >= section.contentFrom &&
              state.selection.from < section.contentTo,
          );
          if (!ancestors.length) return null;
          const tr = state.tr;
          for (const section of ancestors) {
            const node = tr.doc.nodeAt(section.pos)!;
            tr.setNodeMarkup(section.pos, undefined, {
              ...node.attrs,
              collapsed: false,
            });
          }
          return tr;
        },
        props: {
          decorations(state) {
            const sections = headingSections(state.doc);
            const decorations: Decoration[] = [];
            const hidden = sections.filter((s) => s.collapsed);
            state.doc.descendants((node, pos) => {
              if (
                hidden.some((s) => pos >= s.contentFrom && pos < s.contentTo)
              ) {
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
                      const closing = !node.attrs.collapsed;
                      const tr = view.state.tr.setNodeMarkup(
                        section.pos,
                        undefined,
                        { ...node.attrs, collapsed: closing },
                      );
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
      }),
    ];
  },
});
