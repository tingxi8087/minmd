import { useMemo } from "react";
import { Workbook } from "@fortune-sheet/react";
import type { Sheet } from "@fortune-sheet/core";
import "@fortune-sheet/react/dist/index.css";
import { prepareWorkbook } from "@/views/Spreadsheet/workbook";
export default function SharedSpreadsheet({
  sheets,
  height = "calc(100vh - 58px)",
}: {
  sheets: Sheet[];
  height?: string;
}) {
  const data = useMemo(
    () => prepareWorkbook(structuredClone(sheets)),
    [sheets],
  );
  return (
    <div style={{ height, position: "relative" }} aria-label="只读表格">
      <Workbook
        data={data}
        lang="zh"
        allowEdit={false}
        showToolbar={false}
        cellContextMenu={[]}
        headerContextMenu={[]}
        sheetTabContextMenu={[]}
      />
    </div>
  );
}
