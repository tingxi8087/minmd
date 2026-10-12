import type { Cell } from "@fortune-sheet/core";
export function formulaBarText(cell: Cell | null | undefined): string {
  if (!cell) return "";
  if (cell.f) return cell.f;
  if (cell.ct?.t === "inlineStr") {
    const parts: unknown = cell.ct.s;
    return Array.isArray(parts)
      ? parts
          .map((part: unknown) =>
            part && typeof part === "object" && "v" in part
              ? String(part.v ?? "")
              : "",
          )
          .join("")
      : "";
  }
  return String(cell.m ?? cell.v ?? "");
}
/** Fortune 的公式栏仅在选区改变时更新；远端改值后刷新文本，不重设选区或派发编辑事件。 */
export function refreshFormulaBar(
  input: Pick<HTMLElement, "textContent">,
  cell: Cell | null | undefined,
  editing: boolean,
): void {
  if (!editing) input.textContent = formulaBarText(cell);
}
export function sheetEditorActive(root: HTMLElement): boolean {
  const active = root.ownerDocument.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active)) return false;
  if (active.closest(".fortune-fx-input")) return true;
  return Boolean(
    active.closest(".luckysheet-cell-input") &&
    Number(
      root.querySelector<HTMLElement>(".luckysheet-input-box")?.style.zIndex ??
        -1,
    ) >= 0,
  );
}
