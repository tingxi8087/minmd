import { TableView } from "@tiptap/extension-table";
import { TextSelection } from "@tiptap/pm/state";
import { TableMap, addRowAfter, addColumnAfter } from "@tiptap/pm/tables";
import type { Node } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

// Keep Tiptap's table rendering and column resizing, adding controls outside tbody.
export class QuickTableView extends TableView {
  constructor(
    node: Node,
    cellMinWidth: number,
    view?: EditorView,
    attributes: Record<string, any> = {},
  ) {
    super(node, cellMinWidth, view, attributes);
    const scroll = this.dom;
    this.dom = document.createElement("div");
    this.dom.className = "tableQuickWrapper";
    this.dom.appendChild(scroll);
    for (const kind of ["row", "column"] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.contentEditable = "false";
      button.className = `table-append table-append-${kind}`;
      button.setAttribute(
        "aria-label",
        kind === "row" ? "在表格末尾添加行" : "在表格末尾添加列",
      );
      button.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
      button.onmousedown = (event) => event.preventDefault();
      button.onclick = () => {
        if (!view?.editable) return;
        let tablePos: number | undefined;
        view.state.doc.descendants((current, pos) => {
          if (
            current.type.spec.tableRole === "table" &&
            view.nodeDOM(pos) === this.dom
          ) {
            tablePos = pos;
            return false;
          }
        });
        if (tablePos === undefined) return;
        const cell = TableMap.get(this.node).map.at(-1);
        if (cell === undefined) return;
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.near(view.state.doc.resolve(tablePos + 1 + cell + 1)),
          ),
        );
        (kind === "row" ? addRowAfter : addColumnAfter)(
          view.state,
          view.dispatch,
        );
        view.focus();
      };
      this.dom.appendChild(button);
    }
  }
  stopEvent(event: Event) {
    return (
      event.target instanceof Element &&
      Boolean(event.target.closest(".table-append"))
    );
  }
}
