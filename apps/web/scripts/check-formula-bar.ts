import assert from "node:assert/strict";
import {
  formulaBarText,
  refreshFormulaBar,
} from "../src/views/Spreadsheet/formulaBar";
const input = { textContent: "项目预算与执行" };
refreshFormulaBar(input, { v: "远端更新" }, false);
assert.equal(input.textContent, "远端更新");
refreshFormulaBar(input, { v: "不能覆盖本地输入" }, true);
assert.equal(input.textContent, "远端更新");
assert.equal(formulaBarText({ f: "=A1+B1", v: 12, m: "12" }), "=A1+B1");
assert.equal(formulaBarText({ v: 0 }), "0");
assert.equal(formulaBarText({ v: 46305, m: "2026-10-10" }), "2026-10-10");
assert.equal(formulaBarText(null), "");
const malicious = "<img src=x onerror=alert(1)>";
refreshFormulaBar(input, { v: malicious }, false);
assert.equal(
  input.textContent,
  malicious,
  "通过textContent保持纯文本，不作为HTML执行",
);
console.log(
  "公式栏刷新验证通过：远端值、公式优先、日期展示、零和空值、本地输入保护、纯文本安全",
);
