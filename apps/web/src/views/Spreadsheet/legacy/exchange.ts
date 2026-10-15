import { assertUploadSize } from "@/utils/uploadLimits";
import ExcelJS from "exceljs";
import type {
  IWorkbookData,
  ICellData,
  IStyleData,
  IRange,
} from "@univerjs/core";
import { createWorkbook, emptySheet } from "./workbook";
const MAX_CELLS = 200000;
const borderStyles: ExcelJS.BorderStyle[] = [
  "thin",
  "thin",
  "hair",
  "dotted",
  "dashed",
  "dashDot",
  "dashDotDot",
  "double",
  "medium",
  "mediumDashed",
  "mediumDashDot",
  "mediumDashDotDot",
  "slantDashDot",
  "thick",
];
const borderSides = [
  ["t", "top"],
  ["r", "right"],
  ["b", "bottom"],
  ["l", "left"],
] as const;
const colors = [
  "FFFFFF",
  "000000",
  "E7E6E6",
  "44546A",
  "4472C4",
  "ED7D31",
  "A5A5A5",
  "FFC000",
  "5B9BD5",
  "70AD47",
];
function rgb(color?: Partial<ExcelJS.Color> & { tint?: number }) {
  if (!color) return undefined;
  let value =
    color.argb?.slice(-6) ||
    (color.theme !== undefined ? colors[color.theme] : undefined);
  if (!value || !/^[a-f\d]{6}$/i.test(value)) return undefined;
  if (color.tint)
    value = value
      .match(/../g)!
      .map((v) => {
        let n = parseInt(v, 16);
        n =
          color.tint! < 0 ? n * (1 + color.tint!) : n + (255 - n) * color.tint!;
        return Math.round(n).toString(16).padStart(2, "0");
      })
      .join("");
  return `#${value}`;
}
function argb(value?: string | null | void) {
  if (!value) return undefined;
  if (/^#[a-f\d]{6}$/i.test(value)) return `FF${value.slice(1).toUpperCase()}`;
  const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return match
    ? `FF${match
        .slice(1)
        .map((v) => Number(v).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()}`
    : undefined;
}
function fromStyle(cell: ExcelJS.Cell): IStyleData {
  const font = cell.font || {},
    align = cell.alignment || {},
    color = rgb(font.color);
  const fill =
    cell.fill?.type === "pattern" ? rgb(cell.fill.fgColor) : undefined;
  const borders: NonNullable<IStyleData["bd"]> = {};
  for (const [key, side] of borderSides) {
    const border = cell.border?.[side];
    if (border?.style)
      borders[key] = {
        s: Math.max(1, borderStyles.indexOf(border.style)),
        cl: { rgb: rgb(border.color) || "#000000" },
      };
  }
  return {
    bd: Object.keys(borders).length ? borders : undefined,
    ff: font.name,
    fs: font.size,
    bl: font.bold ? 1 : 0,
    it: font.italic ? 1 : 0,
    ul: font.underline ? { s: 1 } : undefined,
    st: font.strike ? { s: 1 } : undefined,
    cl: color ? { rgb: color } : undefined,
    bg: fill ? { rgb: fill } : undefined,
    ht:
      align.horizontal === "center"
        ? 2
        : align.horizontal === "right"
          ? 3
          : align.horizontal === "left"
            ? 1
            : undefined,
    vt:
      align.vertical === "top"
        ? 1
        : align.vertical === "middle"
          ? 2
          : align.vertical === "bottom"
            ? 3
            : undefined,
    tb: align.wrapText ? 3 : undefined,
    n: cell.numFmt ? { pattern: cell.numFmt } : undefined,
  };
}
export async function importXlsx(
  file: File,
  id: string,
  name: string,
): Promise<IWorkbookData> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error("仅支持 .xlsx 文件");
  assertUploadSize(file);
  const excel = new ExcelJS.Workbook();
  try {
    await excel.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error("无法读取 Excel，请检查文件是否损坏或受到加密保护");
  }
  if (!excel.worksheets.length) throw new Error("文件中没有工作表");
  const data = createWorkbook(id, name);
  data.sheets = {};
  data.sheetOrder = [];
  let cells = 0;
  const filters: Record<string, { ref: IRange; filterColumns: unknown[] }> = {};
  for (const source of excel.worksheets) {
    if (source.rowCount > 10000 || source.columnCount > 1000)
      throw new Error("单个工作表最多支持 10000 行、1000 列");
    const sheet = emptySheet(source.name);
    sheet.rowCount = Math.max(200, source.rowCount + 20);
    sheet.columnCount = Math.max(26, source.columnCount + 5);
    source.eachRow({ includeEmpty: false }, (row, r) => {
      sheet.rowData[r - 1] = {
        h: row.height ? (row.height * 4) / 3 : undefined,
        hd: row.hidden ? 1 : 0,
      };
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        if (++cells > MAX_CELLS) throw new Error("最多支持 20 万个非空单元格");
        if (cell.type === ExcelJS.ValueType.Merge) return;
        const value = cell.value;
        let v: ICellData["v"] = null;
        if (value instanceof Date) v = value.getTime() / 86400000 + 25569;
        else if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        )
          v = value;
        else if (value && typeof value === "object") {
          if ("richText" in value)
            v = value.richText.map((run) => run.text).join("");
          else if ("hyperlink" in value) v = value.text;
          else if ("formula" in value || "sharedFormula" in value)
            v =
              cell.result instanceof Date
                ? cell.result.getTime() / 86400000 + 25569
                : typeof cell.result === "object" &&
                    cell.result &&
                    "error" in cell.result
                  ? (cell.result as unknown as { error: string }).error
                  : (cell.result as ICellData["v"]);
          else if ("error" in value) v = value.error;
        }
        const style = fromStyle(cell);
        if (value instanceof Date && !style.n)
          style.n = { pattern: "yyyy-mm-dd" };
        (sheet.cellData[r - 1] ||= {})[c - 1] = {
          v,
          t: typeof v === "number" ? 2 : typeof v === "boolean" ? 3 : 1,
          s: style,
          f: cell.formula ? `=${cell.formula.replace(/^=/, "")}` : undefined,
        };
      });
    });
    source.columns?.forEach((column, c) => {
      if (column.width || column.hidden)
        sheet.columnData[c] = {
          w: column.width ? column.width * 7 + 5 : undefined,
          hd: column.hidden ? 1 : 0,
        };
    });
    for (const merge of source.model.merges || []) {
      const range = source.getCell(merge.split(":")[0]),
        end = source.getCell(merge.split(":")[1] || merge);
      sheet.mergeData.push({
        startRow: Number(range.row) - 1,
        endRow: Number(end.row) - 1,
        startColumn: Number(range.col) - 1,
        endColumn: Number(end.col) - 1,
      });
    }
    const view = source.views?.find((v) => v.state === "frozen");
    if (view?.state === "frozen")
      sheet.freeze = {
        xSplit: view.xSplit || 0,
        ySplit: view.ySplit || 0,
        startRow: view.ySplit || -1,
        startColumn: view.xSplit || -1,
      };
    if (source.autoFilter) {
      const range =
        typeof source.autoFilter === "string"
          ? {
              from: source.autoFilter.split(":")[0],
              to: source.autoFilter.split(":")[1] || source.autoFilter,
            }
          : source.autoFilter;
      const position = (value: string | { row: number; column: number }) =>
        typeof value === "string"
          ? source.getCell(value)
          : source.getCell(value.row, value.column);
      const from = position(range.from),
        to = position(range.to);
      filters[sheet.id] = {
        ref: {
          startRow: Number(from.row) - 1,
          startColumn: Number(from.col) - 1,
          endRow: Number(to.row) - 1,
          endColumn: Number(to.col) - 1,
        },
        filterColumns: [],
      };
    }
    data.sheetOrder.push(sheet.id);
    data.sheets[sheet.id] = sheet;
  }
  if (Object.keys(filters).length)
    data.resources = [
      { name: "SHEET_FILTER_PLUGIN", data: JSON.stringify(filters) },
    ];
  return data;
}
export async function exportXlsx(data: IWorkbookData): Promise<Blob> {
  const excel = new ExcelJS.Workbook();
  const filterResource = data.resources?.find(
    (resource) => resource.name === "SHEET_FILTER_PLUGIN",
  );
  let filters: Record<string, { ref: IRange }> = {};
  if (filterResource?.data) {
    try {
      filters = JSON.parse(filterResource.data);
    } catch {
      /* Keep exporting cell data if optional metadata is damaged. */
    }
  }
  excel.creator = "MinMD";
  excel.calcProperties.fullCalcOnLoad = true;
  for (const id of data.sheetOrder) {
    const sheet = data.sheets[id];
    if (!sheet) continue;
    const output = excel.addWorksheet(sheet.name);
    const filter = filters[id]?.ref;
    if (filter)
      output.autoFilter = {
        from: { row: filter.startRow + 1, column: filter.startColumn + 1 },
        to: { row: filter.endRow + 1, column: filter.endColumn + 1 },
      };
    for (const [r, row] of Object.entries(sheet.cellData || {}))
      for (const [c, cell] of Object.entries(
        row as Record<string, ICellData | null>,
      )) {
        if (!cell) continue;
        const target = output.getCell(Number(r) + 1, Number(c) + 1);
        const value =
          cell.p?.body?.dataStream?.replace(/\r\n$/, "") ?? cell.v ?? null;
        if (cell.f)
          target.value = {
            formula: cell.f.replace(/^=/, ""),
            result:
              typeof value === "boolean" ||
              typeof value === "number" ||
              typeof value === "string"
                ? value
                : undefined,
          };
        else target.value = value as ExcelJS.CellValue;
        const style = typeof cell.s === "string" ? data.styles[cell.s] : cell.s;
        if (style) {
          const color = argb(style.cl?.rgb),
            fill = argb(style.bg?.rgb);
          target.font = {
            name: style.ff || undefined,
            size: style.fs || undefined,
            bold: style.bl === 1,
            italic: style.it === 1,
            underline: style.ul?.s === 1,
            strike: style.st?.s === 1,
            color: color ? { argb: color } : undefined,
          };
          if (fill)
            target.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: fill },
            };
          target.alignment = {
            horizontal:
              style.ht === 1
                ? "left"
                : style.ht === 2
                  ? "center"
                  : style.ht === 3
                    ? "right"
                    : undefined,
            vertical:
              style.vt === 1
                ? "top"
                : style.vt === 2
                  ? "middle"
                  : style.vt === 3
                    ? "bottom"
                    : undefined,
            wrapText: style.tb === 3,
          };
          if (style.n?.pattern) target.numFmt = style.n.pattern;
          const borders: Partial<ExcelJS.Borders> = {};
          for (const [key, side] of borderSides) {
            const border = style.bd?.[key];
            if (border?.s)
              borders[side] = {
                style: borderStyles[border.s] || "thin",
                color: { argb: argb(border.cl?.rgb) || "FF000000" },
              };
          }
          if (Object.keys(borders).length) target.border = borders;
        }
      }
    for (const [r, row] of Object.entries(sheet.rowData || {})) {
      const target = output.getRow(Number(r) + 1);
      if (row?.h) target.height = (row.h * 3) / 4;
      if (row?.hd) target.hidden = true;
    }
    for (const [c, column] of Object.entries(sheet.columnData || {})) {
      const target = output.getColumn(Number(c) + 1);
      if (column?.w) target.width = Math.max(1, (column.w - 5) / 7);
      if (column?.hd) target.hidden = true;
    }
    for (const merge of sheet.mergeData || [])
      output.mergeCells(
        merge.startRow + 1,
        merge.startColumn + 1,
        merge.endRow + 1,
        merge.endColumn + 1,
      );
    if (sheet.freeze && (sheet.freeze.xSplit || sheet.freeze.ySplit))
      output.views = [
        {
          state: "frozen",
          xSplit: sheet.freeze.xSplit,
          ySplit: sheet.freeze.ySplit,
        },
      ];
  }
  const bytes = await excel.xlsx.writeBuffer();
  return new Blob([new Uint8Array(bytes)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
