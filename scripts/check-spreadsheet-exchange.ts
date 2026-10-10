import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { importXlsx, exportXlsx } from "../src/views/Spreadsheet/exchange";

const source = new ExcelJS.Workbook();
const sheet = source.addWorksheet("项目预算");
sheet.addRows([
  ["项目预算"],
  ["项目", "预算"],
  ["设计", 12000],
  ["研发", 28000],
  ["合计", { formula: "SUM(B3:B4)", result: 40000 }],
  ["日期", new Date("2026-10-10T00:00:00Z")],
  ["确认", true],
]);
sheet.mergeCells("A1:D1");
sheet.getCell("A1").font = {
  size: 20,
  bold: true,
  color: { argb: "FF198876" },
};
sheet.getCell("A2").fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE9F5EF" },
};
sheet.getCell("A2").border = {
  bottom: { style: "thin", color: { argb: "FF198876" } },
};
sheet.getCell("B6").numFmt = "yyyy-mm-dd";
sheet.getRow(1).height = 42;
sheet.getColumn(1).width = 24;
sheet.autoFilter = "A2:B4";
sheet.views = [{ state: "frozen", ySplit: 2 }];
source.addWorksheet("事项清单").addRows([
  ["事项", "优先级"],
  ["接入编辑器", "高"],
]);
const binary = await source.xlsx.writeBuffer();
const file = new File([new Uint8Array(binary)], "budget.xlsx");
const data = await importXlsx(file, "test", "预算");
assert.equal(data.sheetOrder.length, 2);
assert.equal(
  data.sheets[data.sheetOrder[0]].cellData?.[4]?.[1]?.f,
  "=SUM(B3:B4)",
);
const exported = new ExcelJS.Workbook();
await exported.xlsx.load(await (await exportXlsx(data)).arrayBuffer());
const result = exported.worksheets[0];
assert.equal(result.autoFilter, "A2:B4");
assert.equal(result.name, "项目预算");
assert.equal(result.getCell("B3").value, 12000);
assert.equal(result.getCell("B5").formula, "SUM(B3:B4)");
assert.equal(result.getCell("B5").result, 40000);
assert.equal(result.getCell("A1").font.size, 20);
assert.equal(result.getCell("A1").font.color?.argb, "FF198876");
assert.equal(
  (result.getCell("A2").fill as ExcelJS.FillPattern).fgColor?.argb,
  "FFE9F5EF",
);
assert.equal(result.getCell("A2").border.bottom?.style, "thin");
assert.deepEqual(result.model.merges, ["A1:D1"]);
assert.equal(result.getRow(1).height, 42);
assert.equal(result.getColumn(1).width, 24);
assert.equal(result.views[0].state, "frozen");
assert.equal(result.getCell("B7").value, true);
assert.equal(
  (result.getCell("B6").value as Date).toISOString(),
  "2026-10-10T00:00:00.000Z",
);
assert.equal(exported.worksheets[1].getCell("A2").value, "接入编辑器");
await assert.rejects(
  importXlsx(new File(["broken"], "broken.xlsx"), "bad", "bad"),
  /无法读取/,
);
await assert.rejects(
  importXlsx(new File(["bad"], "bad.xls"), "bad", "bad"),
  /仅支持/,
);
const empty = new ExcelJS.Workbook();
empty.addWorksheet("空白");
const emptyData = await importXlsx(
  new File([new Uint8Array(await empty.xlsx.writeBuffer())], "empty.xlsx"),
  "empty",
  "空白",
);
assert.equal(emptyData.sheetOrder.length, 1);
assert.deepEqual(emptyData.sheets[emptyData.sheetOrder[0]].cellData, {});
console.log(
  "XLSX roundtrip passed: formulas, two sheets, styles, borders, merges, dates, dimensions and invalid files.",
);
