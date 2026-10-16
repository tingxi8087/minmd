import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { closeHistory } from "@tiptap/pm/history";
import { yUndoPluginKey } from "@tiptap/y-tiptap";
import { collapseKey } from "./headingCollapse";
import { headingSections } from "./headingSections";

export type SearchMatch = { from: number; to: number };
export type DocumentSearchState = {
  query: string;
  caseSensitive: boolean;
  matches: SearchMatch[];
  active: number;
};
export const documentSearchKey = new PluginKey<DocumentSearchState>(
  "documentSearch",
);
const emptyState: DocumentSearchState = {
  query: "",
  caseSensitive: false,
  matches: [],
  active: -1,
};

// Search each text block separately. Inline atoms and line breaks are boundaries;
// adjacent styled text nodes remain a single searchable run.
export function findDocumentMatches(
  doc: ProseMirrorNode,
  query: string,
  caseSensitive: boolean,
): SearchMatch[] {
  if (!query) return [];
  const pattern = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    caseSensitive ? "gu" : "giu",
  );
  const matches: SearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    let text = "",
      start = pos + 1;
    const flush = () => {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern))
        matches.push({
          from: start + match.index!,
          to: start + match.index! + match[0].length,
        });
      text = "";
    };
    node.forEach((child, offset) => {
      if (child.isText) {
        if (!text) start = pos + 1 + offset;
        text += child.text;
      } else flush();
    });
    flush();
    return false;
  });
  return matches;
}
export function createDocumentSearchPlugin() {
  return new Plugin<DocumentSearchState>({
    key: documentSearchKey,
    state: {
      init: () => ({ ...emptyState }),
      apply(tr, previous) {
        const patch = tr.getMeta(documentSearchKey) as
          | Partial<
              Pick<DocumentSearchState, "query" | "caseSensitive" | "active">
            >
          | undefined;
        if (!tr.docChanged && !patch) return previous;
        const query = patch?.query ?? previous.query;
        const caseSensitive = patch?.caseSensitive ?? previous.caseSensitive;
        const matches =
          tr.docChanged ||
          query !== previous.query ||
          caseSensitive !== previous.caseSensitive
            ? findDocumentMatches(tr.doc, query, caseSensitive)
            : previous.matches;
        let active = patch?.active ?? previous.active;
        if (patch?.query !== undefined || patch?.caseSensitive !== undefined)
          active = 0;
        else if (tr.docChanged && previous.matches[previous.active]) {
          const mapped = tr.mapping.map(
            previous.matches[previous.active].from,
            1,
          );
          const next = matches.findIndex((match) => match.from >= mapped);
          active = next < 0 ? matches.length - 1 : next;
        }
        return {
          query,
          caseSensitive,
          matches,
          active: matches.length
            ? Math.max(0, Math.min(active, matches.length - 1))
            : -1,
        };
      },
    },
    props: {
      decorations(state) {
        const search = documentSearchKey.getState(state)!;
        return DecorationSet.create(
          state.doc,
          search.matches.map((match, index) =>
            Decoration.inline(match.from, match.to, {
              class:
                index === search.active
                  ? "document-search-match document-search-current"
                  : "document-search-match",
            }),
          ),
        );
      },
    },
  });
}
export const DocumentSearch = Extension.create({
  name: "documentSearch",
  addProseMirrorPlugins: () => [createDocumentSearchPlugin()],
});
export const searchState = (editor: Editor) =>
  documentSearchKey.getState(editor.state) ?? emptyState;
export function updateDocumentSearch(
  editor: Editor,
  patch: Partial<
    Pick<DocumentSearchState, "query" | "caseSensitive" | "active">
  >,
) {
  editor.view.dispatch(editor.state.tr.setMeta(documentSearchKey, patch));
}
export function revealSearchMatch(editor: Editor) {
  const { matches, active } = searchState(editor);
  const match = matches[active];
  if (!match) return;
  const collapsed = new Set(collapseKey.getState(editor.state) ?? []);
  for (const section of headingSections(editor.state.doc)) {
    if (match.from >= section.contentFrom && match.from < section.contentTo) {
      const node = editor.state.doc.nodeAt(section.pos)!;
      collapsed.delete(
        typeof node.attrs.blockId === "string"
          ? node.attrs.blockId
          : `position-${section.pos}`,
      );
    }
  }
  const tr = editor.state.tr.setSelection(
    TextSelection.create(editor.state.doc, match.from, match.to),
  );
  if (collapseKey.getState(editor.state)) tr.setMeta(collapseKey, collapsed);
  editor.view.dispatch(tr);
  // A collapsed fold is a document attribute. Reveal it locally without sending
  // a content change to collaborators or altering a read-only document.
  editor.view.dom
    .querySelectorAll("[data-search-reveal]")
    .forEach((element) => element.removeAttribute("data-search-reveal"));
  let element = editor.view.nodeDOM(match.from);
  if (!element) element = editor.view.domAtPos(match.from).node;
  let ancestor = element instanceof Element ? element : element.parentElement;
  while (ancestor && ancestor !== editor.view.dom) {
    if (ancestor.classList.contains("doc-fold"))
      ancestor.setAttribute("data-search-reveal", "true");
    ancestor = ancestor.parentElement;
  }
  const scroll = () => {
    if (editor.isDestroyed) return;
    editor.view.dom
      .querySelector(".document-search-current")
      ?.scrollIntoView?.({ block: "center", inline: "nearest" });
  };
  scroll();
  requestAnimationFrame(scroll);
}
export function replaceDocumentMatches(
  editor: Editor,
  replacement: string,
  all: boolean,
): number {
  if (!editor.isEditable) return 0;
  const { matches, active } = searchState(editor);
  const targets = all ? matches : matches[active] ? [matches[active]] : [];
  if (!targets.length) return 0;
  // One transaction preserves the surrounding structure and creates one undo
  // item. Close both undo engines' capture windows around a replacement action.
  const undoManager = yUndoPluginKey.getState(editor.state)?.undoManager;
  undoManager?.stopCapturing();
  let tr = closeHistory(editor.state.tr);
  for (const match of [...targets].reverse()) {
    const resolved = tr.doc.resolve(match.from);
    const marks = resolved.nodeAfter?.marks ?? resolved.marks();
    if (replacement)
      tr = tr.replaceWith(
        match.from,
        match.to,
        editor.schema.text(replacement, marks),
      );
    else tr = tr.delete(match.from, match.to);
  }
  editor.view.dispatch(tr);
  editor.view.dispatch(closeHistory(editor.state.tr));
  undoManager?.stopCapturing();
  return targets.length;
}
