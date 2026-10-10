import {
  LocaleType,
  type IWorkbookData,
  type IWorksheetData,
  type ICellData,
} from "@univerjs/presets";
export function emptySheet(name = "工作表1"): IWorksheetData {
  return {
    id: crypto.randomUUID(),
    name,
    tabColor: "",
    hidden: 0,
    freeze: { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
    zoomRatio: 1,
    scrollTop: 0,
    scrollLeft: 0,
    rowHeader: { width: 46 },
    columnHeader: { height: 24 },
    showGridlines: 1,
    rightToLeft: 0,
    rowCount: 200,
    columnCount: 26,
    cellData: {},
    mergeData: [],
    rowData: {},
    columnData: {},
    defaultRowHeight: 28,
    defaultColumnWidth: 110,
  };
}
export function createWorkbook(
  id: string,
  name: string,
  sample = false,
): IWorkbookData {
  const sheet = emptySheet(sample ? "项目预算" : "工作表1");
  if (sample) {
    const rows = [
      ["项目", "预算（元）", "负责人", "状态"],
      ["产品设计", 12000, "林小满", "进行中"],
      ["研发投入", 28000, "Tingxi", "计划中"],
      ["用户调研", 6000, "陈一", "已完成"],
      ["合计", 46000, "", ""],
    ];
    rows.forEach((row, r) => {
      sheet.cellData[r] = {};
      row.forEach((v, c) => {
        sheet.cellData[r][c] = {
          v,
          t: typeof v === "number" ? 2 : 1,
          s:
            r === 0
              ? { bl: 1, bg: { rgb: "#E9F5EF" }, cl: { rgb: "#198876" } }
              : undefined,
        } as ICellData;
      });
    });
    sheet.cellData[4][1] = { f: "=SUM(B2:B4)", v: 46000, t: 2 };
    sheet.columnData = {
      0: { w: 180 },
      1: { w: 140 },
      2: { w: 120 },
      3: { w: 120 },
    };
  }
  return {
    id,
    name,
    appVersion: "1.0.4",
    locale: LocaleType.ZH_CN,
    styles: {},
    sheetOrder: [sheet.id],
    sheets: { [sheet.id]: sheet },
  };
}
