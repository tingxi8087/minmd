import type { FUniver } from "@univerjs/presets";

export const ribbonLocale = {
  minmd: {
    sheetRibbon: {
      rowBefore: "上方插行",
      rowAfter: "下方插行",
      columnBefore: "左侧插列",
      columnAfter: "右侧插列",
      dropdown: "下拉菜单",
      date: "日期",
    },
  },
};

export function configureRibbon(
  api: FUniver,
  reportError: (text: string) => void,
) {
  const items = [
    {
      key: "rowBefore",
      command: "sheet.command.insert-row-before",
      icon: "InsertRowAboveDoubleIcon",
      row: 1,
      column: 1,
      axis: "row",
    },
    {
      key: "rowAfter",
      command: "sheet.command.insert-row-after",
      icon: "InsertRowBelowDoubleIcon",
      row: 2,
      column: 1,
      axis: "row",
    },
    {
      key: "columnBefore",
      command: "sheet.command.insert-col-before",
      icon: "LeftInsertColumnDoubleIcon",
      row: 1,
      column: 2,
      axis: "column",
    },
    {
      key: "columnAfter",
      command: "sheet.command.insert-col-after",
      icon: "RightInsertColumnDoubleIcon",
      row: 2,
      column: 2,
      axis: "column",
    },
  ];
  for (const item of items) {
    const title = `minmd.sheetRibbon.${item.key}`;
    api
      .createMenu({
        id: `minmd.insert.${item.key}`,
        title,
        tooltip: title,
        icon: item.icon,
        gridLayout: {
          row: item.row,
          column: item.column,
          showLabel: true,
          width: 104,
        },
        action: () => {
          const range = api
            .getActiveWorkbook()
            ?.getActiveSheet()
            .getActiveRange()
            ?.getRange();
          if (!range) {
            reportError("请先选择单元格");
            return;
          }
          const value =
            item.axis === "row"
              ? range.endRow - range.startRow + 1
              : range.endColumn - range.startColumn + 1;
          void api
            .executeCommand(item.command, { value })
            .then((done) => {
              if (!done)
                reportError("无法在当前选区插入，请检查选区或保护设置");
            })
            .catch(() => reportError("插入失败，请检查选区或保护设置"));
        },
      })
      .appendTo("ribbon.insert.edit");
  }
}
