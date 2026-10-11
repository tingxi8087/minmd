import type { Sheet } from "@fortune-sheet/core";
import { fromLegacy, toLegacy } from "./workbook";
import { importXlsx as read, exportXlsx as write } from "./legacy/exchange";
export const importXlsx = async (file: File, id: string, name: string) =>
  fromLegacy(await read(file, id, name));
export const exportXlsx = (sheets: Sheet[], name = "表格") =>
  write(toLegacy(sheets, "export", name));
