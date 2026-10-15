import { v4 as createId } from "uuid";
import { Extension } from "@tiptap/core";
import { Plugin, type Transaction } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { ySyncPluginKey } from "y-prosemirror";
export const blockTypes = [
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "horizontalRule",
  "image",
  "callout",
  "fold",
];
/** 稳定块ID用于外部修改定位；复制和拆分块时重新分配重复ID。 */
export const BlockId = Extension.create<{ assign: boolean }>({
  name: "blockId",
  addOptions: () => ({ assign: true }),
  addGlobalAttributes: () => [
    {
      types: blockTypes,
      attributes: {
        blockId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-block-id"),
          renderHTML: (attrs) =>
            attrs.blockId ? { "data-block-id": attrs.blockId } : {},
        },
      },
    },
  ],
  addProseMirrorPlugins() {
    if (!this.options.assign) return [];
    return [
      new Plugin({
        appendTransaction(transactions, _old, state) {
          if (
            !transactions.some((tr) => tr.docChanged) ||
            ySyncPluginKey.getState(state)?.isChangeOrigin
          )
            return null;
          const tr = repairBlockIds(state.doc, state.tr);
          return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
        },
      }),
    ];
  },
});

export function repairBlockIds(
  doc: ProseMirrorNode,
  tr: Transaction,
): Transaction {
  const seen = new Set<string>();
  doc.descendants((node, pos) => {
    if (!blockTypes.includes(node.type.name)) return;
    const id: unknown = node.attrs.blockId;
    if (typeof id === "string" && id && !seen.has(id)) {
      seen.add(id);
      return;
    }
    const next = createId();
    seen.add(next);
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: next });
  });
  return tr;
}
