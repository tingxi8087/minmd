import { v4 as createId } from "uuid";
import type { Cell, Sheet } from "@fortune-sheet/core";
import {
  is_date as isDateFormat,
  update as formatNumber,
} from "@fortune-sheet/core";
import type { IWorkbookData, ICellData, IStyleData } from "@univerjs/core";
import {
  createWorkbook as legacyWorkbook,
  emptySheet,
} from "./legacy/workbook";

function formattedCell(cell: Cell): Cell {
  const value = { ...cell, ct: cell.ct ? { ...cell.ct } : undefined };
  value.m ??= value.v == null ? "" : String(value.v);
  if (typeof value.v === "number" && value.ct?.fa) {
    try {
      value.m = String(formatNumber(value.ct.fa, value.v));
      value.ct.t = isDateFormat(value.ct.fa, value.v) ? "d" : "n";
    } catch {
      value.m = String(value.v);
    }
  }
  return value;
}

// 旧数据只在导入、导出与一次性本地迁移时转换，不再运行 Univer 编辑器。
export function fromLegacy(book: IWorkbookData): Sheet[] {
  return book.sheetOrder.map((id, order) => {
    const old = book.sheets[id];
    const config: NonNullable<Sheet["config"]> = {
      merge: {},
      rowlen: {},
      columnlen: {},
      rowhidden: {},
      colhidden: {},
      borderInfo: [],
    };
    const celldata: NonNullable<Sheet["celldata"]> = [];
    for (const [r, row] of Object.entries(old.cellData || {}))
      for (const [c, value] of Object.entries(
        row as Record<string, ICellData | null>,
      )) {
        if (!value) continue;
        const s =
          (typeof value.s === "string" ? book.styles[value.s] : value.s) || {};
        const cell: Cell = {
          v: value.v ?? undefined,
          m: value.v == null ? "" : String(value.v),
          f: value.f ?? undefined,
          ct: {
            fa: s.n?.pattern || "General",
            t:
              typeof value.v === "number"
                ? "n"
                : typeof value.v === "boolean"
                  ? "b"
                  : "g",
          },
          bl: s.bl ?? undefined,
          it: s.it ?? undefined,
          fs: s.fs ?? undefined,
          ff: s.ff ?? undefined,
          fc: s.cl?.rgb ?? undefined,
          bg: s.bg?.rgb ?? undefined,
          ht: s.ht === 2 ? 0 : s.ht === 3 ? 2 : 1,
          vt: s.vt === 1 ? 1 : s.vt === 3 ? 2 : 0,
          tb: s.tb === 3 ? "2" : "1",
          un: s.ul?.s === 1 ? 1 : 0,
          cl: s.st?.s === 1 ? 1 : 0,
        };
        celldata.push({ r: Number(r), c: Number(c), v: formattedCell(cell) });
        if (s.bd)
          config.borderInfo!.push({
            rangeType: "cell",
            value: {
              row_index: Number(r),
              col_index: Number(c),
              ...Object.fromEntries(
                Object.entries(s.bd).map(([side, b]) => [
                  side,
                  { style: b?.s, color: b?.cl?.rgb },
                ]),
              ),
            },
          });
      }
    for (const [r, v] of Object.entries(old.rowData || {})) {
      if (v.h) config.rowlen![r] = v.h;
      if (v.hd) config.rowhidden![r] = 0;
    }
    for (const [c, v] of Object.entries(old.columnData || {})) {
      if (v.w) config.columnlen![c] = v.w;
      if (v.hd) config.colhidden![c] = 0;
    }
    for (const m of old.mergeData || []) {
      const merge = {
        r: m.startRow,
        c: m.startColumn,
        rs: m.endRow - m.startRow + 1,
        cs: m.endColumn - m.startColumn + 1,
      };
      config.merge![`${merge.r}_${merge.c}`] = merge;
      for (let r = m.startRow; r <= m.endRow; r++)
        for (let c = m.startColumn; c <= m.endColumn; c++) {
          let entry = celldata.find((x) => x.r === r && x.c === c);
          if (!entry) {
            entry = { r, c, v: {} };
            celldata.push(entry);
          }
          entry.v ||= {};
          entry.v.mc =
            r === merge.r && c === merge.c ? merge : { r: merge.r, c: merge.c };
        }
    }
    const filter = book.resources?.find(
      (r) => r.name === "SHEET_FILTER_PLUGIN",
    );
    const ref = filter
      ? (
          JSON.parse(filter.data) as Record<
            string,
            {
              ref: {
                startRow: number;
                endRow: number;
                startColumn: number;
                endColumn: number;
              };
            }
          >
        )[id]?.ref
      : undefined;
    const x = old.freeze?.xSplit || 0,
      y = old.freeze?.ySplit || 0;
    return {
      id,
      name: old.name || "工作表",
      order,
      status: order === 0 ? 1 : 0,
      luckysheet_select_save: [{ row: [0, 0], column: [0, 0] }],
      row: old.rowCount,
      column: old.columnCount,
      defaultRowHeight: old.defaultRowHeight,
      defaultColWidth: old.defaultColumnWidth,
      showGridLines: old.showGridlines !== 0,
      config,
      celldata,
      filter_select: ref
        ? {
            row: [ref.startRow, ref.endRow],
            column: [ref.startColumn, ref.endColumn],
          }
        : undefined,
      frozen:
        x || y
          ? {
              type: x && y ? "rangeBoth" : x ? "rangeColumn" : "rangeRow",
              range: { row_focus: y - 1, column_focus: x - 1 },
            }
          : undefined,
    };
  });
}
export function toLegacy(
  sheets: Sheet[],
  id: string,
  name: string,
): IWorkbookData {
  const book = legacyWorkbook(id, name);
  book.sheets = {};
  book.sheetOrder = [];
  const filters: Record<string, unknown> = {};
  for (const source of sheets) {
    const sheet = emptySheet(source.name);
    sheet.id = source.id || createId();
    sheet.rowCount = source.row || 200;
    sheet.columnCount = source.column || 26;
    sheet.defaultRowHeight = source.defaultRowHeight || 28;
    sheet.defaultColumnWidth = source.defaultColWidth || 110;
    sheet.showGridlines = source.showGridLines === false ? 0 : 1;
    const entries = source.data
      ? source.data.flatMap((row, r) =>
          row.flatMap((v, c) => (v ? [{ r, c, v }] : [])),
        )
      : source.celldata || [];
    for (const { r, c, v } of entries) {
      if (!v) continue;
      const style: IStyleData = {
        bl: v.bl,
        it: v.it,
        ff: typeof v.ff === "string" ? v.ff : undefined,
        fs: v.fs,
        cl: v.fc ? { rgb: v.fc } : undefined,
        bg: v.bg ? { rgb: v.bg } : undefined,
        ht: v.ht === 0 ? 2 : v.ht === 2 ? 3 : 1,
        vt: v.vt === 1 ? 1 : v.vt === 2 ? 3 : 2,
        tb: v.tb === "2" ? 3 : undefined,
        n: v.ct?.fa ? { pattern: v.ct.fa } : undefined,
        ul: v.un ? { s: 1 } : undefined,
        st: v.cl ? { s: 1 } : undefined,
      };
      (sheet.cellData[r] ||= {})[c] = {
        v: v.v ?? null,
        f: v.f,
        s: style,
      } as ICellData;
    }
    for (const border of source.config?.borderInfo || []) {
      if (border.rangeType !== "cell") continue;
      const b = border.value as {
        row_index: number;
        col_index: number;
      } & Record<string, { style: number; color: string }>;
      const cell = sheet.cellData[b.row_index]?.[b.col_index];
      if (!cell) continue;
      const s = cell.s as IStyleData;
      s.bd = {};
      for (const side of ["t", "r", "b", "l"] as const)
        if (b[side])
          s.bd[side] = { s: b[side].style, cl: { rgb: b[side].color } };
    }
    for (const [r, h] of Object.entries(source.config?.rowlen || {}))
      sheet.rowData[Number(r)] = { h };
    for (const [r] of Object.entries(source.config?.rowhidden || {}))
      (sheet.rowData[Number(r)] ||= {}).hd = 1;
    for (const [c, w] of Object.entries(source.config?.columnlen || {}))
      sheet.columnData[Number(c)] = { w };
    for (const [c] of Object.entries(source.config?.colhidden || {}))
      (sheet.columnData[Number(c)] ||= {}).hd = 1;
    sheet.mergeData = Object.values(source.config?.merge || {}).map((m) => ({
      startRow: m.r,
      startColumn: m.c,
      endRow: m.r + m.rs - 1,
      endColumn: m.c + m.cs - 1,
    }));
    if (source.frozen?.range) {
      const { row_focus, column_focus } = source.frozen.range;
      sheet.freeze = {
        xSplit: column_focus + 1,
        ySplit: row_focus + 1,
        startRow: row_focus,
        startColumn: column_focus,
      };
    }
    if (source.filter_select)
      filters[sheet.id] = {
        ref: {
          startRow: source.filter_select.row[0],
          endRow: source.filter_select.row[1],
          startColumn: source.filter_select.column[0],
          endColumn: source.filter_select.column[1],
        },
        filterColumns: [],
      };
    book.sheetOrder.push(sheet.id);
    book.sheets[sheet.id] = sheet;
  }
  if (Object.keys(filters).length)
    book.resources = [
      { name: "SHEET_FILTER_PLUGIN", data: JSON.stringify(filters) },
    ];
  return book;
}
export const createWorkbook = (id: string, name: string, sample = false) =>
  fromLegacy(legacyWorkbook(id, name, sample));

export function prepareWorkbook(sheets: Sheet[]): Sheet[] {
  return sheets.map((sheet) => {
    // FortuneSheet 初始化读取稀疏 celldata；服务端权威状态使用 data 矩阵。
    const { data, celldata, ...rest } = sheet;
    const cells = data
      ? data.flatMap((row, r) =>
          row.flatMap((v, c) => (v ? [{ r, c, v }] : [])),
        )
      : (celldata ?? []);
    return {
      ...rest,
      luckysheet_select_save: [
        { row: [0, 0], column: [0, 0], row_focus: 0, column_focus: 0 },
      ],
      celldata: cells.map((cell) => ({
        ...cell,
        v: cell.v ? formattedCell(cell.v) : null,
      })),
    };
  });
}
