import { describe, expect, test } from "bun:test";
import {
  createHeadlessContext,
  execfunction,
  insertRowCol,
  deleteRowCol,
  SelectiveCellHistory,
  StableRows,
} from "../scripts/sheet-engine-experiment";

describe("Fortune 服务端协作选型实验", () => {
  test("无 DOM 计算公式，行列插删维护本表公式和尺寸", () => {
    const ctx = createHeadlessContext([
      {
        id: "s",
        name: "One",
        row: 3,
        column: 3,
        data: [
          [{ v: 2 }, { f: "=A1*3", v: 6 }, null],
          [null, null, null],
          [null, null, null],
        ],
        calcChain: [{ r: 0, c: 1, id: "s" }],
      },
    ]);
    expect(
      execfunction(ctx, "=A1*3", 0, 1, "s", undefined, false, true)[1],
    ).toBe(6);
    insertRowCol(
      ctx,
      { type: "row", index: 0, count: 1, direction: "lefttop", id: "s" },
      false,
    );
    expect(ctx.luckysheetfile[0].data?.[1][1]?.f).toBe("=A2*3");
    expect(ctx.luckysheetfile[0].row).toBe(4);
    deleteRowCol(ctx, { type: "row", start: 0, end: 0, id: "s" });
    expect(ctx.luckysheetfile[0].data?.[0][1]?.f).toBe("=A1*3");
    expect(ctx.luckysheetfile[0].row).toBe(3);
  });

  test("上游跨表公式重定位缺陷得到复现，不能直接用于生产", () => {
    const ctx = createHeadlessContext([
      {
        id: "s",
        name: "One",
        data: [
          [{ v: 2 }, null],
          [null, null],
        ],
        calcChain: [],
      },
      {
        id: "t",
        name: "Two",
        data: [
          [{ v: 7 }, { f: "=A1+One!A1", v: 9 }],
          [null, null],
        ],
        calcChain: [{ r: 0, c: 1, id: "t" }],
      },
    ]);
    insertRowCol(
      ctx,
      { type: "row", index: 0, count: 1, direction: "lefttop", id: "s" },
      false,
    );
    // 正确结果应为 =A1+One!A2；上游错误地移动了未受影响的 Two!A1。
    expect(ctx.luckysheetfile[1].data?.[0][1]?.f).toBe("=A2+One!A2");
    expect(
      execfunction(
        ctx,
        "=SUM(One!A1:A3)",
        0,
        1,
        "t",
        undefined,
        false,
        true,
      )[1],
    ).toBe(2);
  });

  test("稳定行定位保留并发插入且把旧坐标输入定位到原行", () => {
    const rows = new StableRows(["r0", "r1", "r2"]);
    const oldRow = rows.ids[1];
    rows.insertBefore("r1", ["a-new"]);
    rows.insertBefore("r1", ["b-new"]);
    expect(rows.resolve(oldRow)).toBe(3);
    rows.remove(["r0", "r1"]);
    expect(rows.ids).toEqual(["a-new", "b-new", "r2"]);
  });

  test("撤销自己的旧写入不覆盖他人后来同格写入", () => {
    const cell = new SelectiveCellHistory();
    cell.write("a", "A");
    cell.write("b", "B");
    expect(cell.undo("a")).toBe("B");
    expect(cell.undo("b")).toBe("");
  });
});
