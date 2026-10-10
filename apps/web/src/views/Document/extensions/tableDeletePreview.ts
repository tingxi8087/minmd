import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { isInTable, selectedRect } from "@tiptap/pm/tables";
export const tableDeletePreview = new PluginKey<"row" | "column" | null>(
  "tableDeletePreview",
);
export const TableDeletePreview = Extension.create({
  name: "tableDeletePreview",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tableDeletePreview,
        state: {
          init: () => null,
          apply: (tr, previous) =>
            tr.getMeta(tableDeletePreview) !== undefined
              ? tr.getMeta(tableDeletePreview)
              : tr.docChanged || tr.selectionSet
                ? null
                : previous,
        },
        props: {
          decorations(state) {
            const mode = tableDeletePreview.getState(state);
            if (!mode || !isInTable(state)) return DecorationSet.empty;
            const rect = selectedRect(state);
            const range =
              mode === "row"
                ? { ...rect, left: 0, right: rect.map.width }
                : { ...rect, top: 0, bottom: rect.map.height };
            const marks = rect.map.cellsInRect(range).map((offset) => {
              const pos = rect.tableStart + offset;
              return Decoration.node(
                pos,
                pos + state.doc.nodeAt(pos)!.nodeSize,
                { class: "table-delete-preview" },
              );
            });
            return DecorationSet.create(state.doc, marks);
          },
        },
      }),
    ];
  },
});
