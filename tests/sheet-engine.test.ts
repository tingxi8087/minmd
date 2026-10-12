import { describe, expect, test } from "bun:test";
import { sheetCollaborationConfig } from "../config/sheet-collaboration";
import {
  SheetEngine,
  SheetEngineError,
} from "../apps/app_server/src/modules/collaboration/sheet-engine";
import type {
  SheetEngineSnapshot,
  SheetJson,
} from "../apps/app_server/src/modules/collaboration/sheet-engine";

test("XLSX 日期及数字格式由权威投影生成，持久恢复与公式更新不显示序列号", () => {
  const engine = new SheetEngine([
    {
      id: "dates",
      name: "日期",
      row: 2,
      column: 3,
      celldata: [
        {
          r: 0,
          c: 0,
          v: { v: 46305, m: "46305", ct: { fa: "yyyy-mm-dd", t: "n" } },
        },
        { r: 0, c: 1, v: { f: "=A1+1", ct: { fa: "yyyy-mm-dd", t: "n" } } },
        { r: 0, c: 2, v: { v: 1.5, m: "1.5", ct: { fa: "0.00", t: "n" } } },
      ],
    },
  ]);
  const cells = () =>
    engine.snapshot().workbook[0]!.data as Record<string, SheetJson>[][];
  expect(cells()[0]![0]!.m).toBe("2026-10-10");
  expect(cells()[0]![0]!.v).toBe(46305);
  expect(cells()[0]![0]!.ct).toEqual({ fa: "yyyy-mm-dd", t: "d" });
  expect(cells()[0]![1]!.m).toBe("2026-10-11");
  expect(cells()[0]![2]!.m).toBe("1.50");
  expect(SheetEngine.restore(engine.serialize()).snapshot()).toEqual(
    engine.snapshot(),
  );
  engine.dispatch("alice", engine.revision, "change-date", [
    {
      type: "setCellContent",
      sheetId: "dates",
      row: 0,
      column: 0,
      value: 46306,
    },
  ]);
  expect(cells()[0]![0]!.m).toBe("2026-10-11");
  expect(cells()[0]![1]!.m).toBe("2026-10-12");
  expect(SheetEngine.restore(engine.serialize()).snapshot()).toEqual(
    engine.snapshot(),
  );
});

test("正式表格协作修订和个人撤销窗口统一校验", () => {
  const config = sheetCollaborationConfig({});
  expect(config.SHEET_COLLAB_REVISION_WINDOW).toBe(256);
  expect(config.SHEET_COLLAB_UNDO_WINDOW).toBe(256);
  expect(config.SHEET_COLLAB_HISTORY_WINDOW).toBe(4096);
  expect(config.SHEET_COLLAB_MAX_MESSAGE_BYTES).toBe(8388608);
  expect(config.SHEET_COLLAB_MAX_CONTENT_BYTES).toBe(8388608);
  expect(config.SHEET_COLLAB_MESSAGES_PER_SECOND).toBe(100);
  expect(() =>
    sheetCollaborationConfig({ SHEET_COLLAB_MESSAGES_PER_SECOND: "0" }),
  ).toThrow();
  expect(() =>
    sheetCollaborationConfig({ SHEET_COLLAB_MAX_MESSAGE_BYTES: "8388609" }),
  ).toThrow();
  expect(() =>
    sheetCollaborationConfig({ SHEET_COLLAB_REVISION_WINDOW: "15" }),
  ).toThrow();
  expect(() =>
    sheetCollaborationConfig({ SHEET_COLLAB_UNDO_WINDOW: "0" }),
  ).toThrow();
  expect(() =>
    sheetCollaborationConfig({ SHEET_COLLAB_HISTORY_WINDOW: "4095" }),
  ).toThrow();
});

test("房间内容按UTF-8字节计数，并拒绝工作表和网格规模越界", () => {
  const workbook = (text: string) => [
    {
      id: "limit",
      name: "大小限制",
      row: 1,
      column: 1,
      celldata: [{ r: 0, c: 0, v: { v: text } }],
    },
  ];
  expect(
    () => new SheetEngine(workbook("a".repeat(400)), { contentMaxBytes: 1024 }),
  ).not.toThrow();
  expect(
    () =>
      new SheetEngine(workbook("中".repeat(400)), { contentMaxBytes: 1024 }),
  ).toThrow("UTF-8");
  expect(
    () =>
      new SheetEngine(
        Array.from({ length: 31 }, (_, index) => ({
          id: String(index),
          name: String(index),
          row: 1,
          column: 1,
          celldata: [],
        })),
      ),
  ).toThrow("工作表数量");
  expect(
    () =>
      new SheetEngine([{ id: "limit", name: "越界", row: 10001, column: 1 }]),
  ).toThrow();
  expect(
    () =>
      new SheetEngine([{ id: "limit", name: "越界", row: 1, column: 1001 }]),
  ).toThrow();
  expect(
    () =>
      new SheetEngine([{ id: "limit", name: "越界", row: 1000, column: 301 }]),
  ).toThrow("单元格数量");
  const engine = new SheetEngine([
    { id: "limit", name: "网格", row: 300, column: 1000 },
  ]);
  const before = engine.snapshot();
  expect(() =>
    engine.dispatch("a", 0, "over-grid", [
      { type: "insertRows", sheetId: "limit", index: 0, count: 1 },
    ]),
  ).toThrow("规模");
  expect(engine.snapshot()).toEqual(before);
});

function seed() {
  return [
    {
      id: "s",
      name: "One",
      row: 4,
      column: 4,
      data: [
        [{ v: 2 }, { f: "=A1*3", v: 99 }, { f: "=B1+1", v: 0 }, null],
        [null, null, null, null],
        [null, null, null, null],
        [null, null, null, null],
      ],
    },
  ];
}
function cell(
  snapshot: SheetEngineSnapshot,
  row: number,
  column: number,
  sheet = "s",
) {
  return (
    snapshot.workbook.find((entry) => entry.id === sheet)!.data as SheetJson[][]
  )[row][column] as Record<string, SheetJson> | null;
}

describe("生产表格权威引擎", () => {
  test("权威公式计算保留数字格式显示", () => {
    const engine = new SheetEngine([
      {
        id: "s",
        name: "One",
        row: 1,
        column: 1,
        data: [[{ f: "=1/4", ct: { fa: "0.0%", t: "n" } }]],
      },
    ]);
    expect(cell(engine.snapshot(), 0, 0)?.v).toBe(0.25);
    expect(cell(engine.snapshot(), 0, 0)?.m).toBe("25.0%");
  });
  test("服务端按依赖顺序计算，循环依赖给出错误值", () => {
    const engine = new SheetEngine(seed());
    expect(cell(engine.snapshot(), 0, 1)?.v).toBe(6);
    expect(cell(engine.snapshot(), 0, 2)?.v).toBe(7);
    const result = engine.dispatch("a", 0, "cycle", [
      { type: "setCell", sheetId: "s", row: 0, column: 0, value: { f: "=C1" } },
    ]);
    expect(cell(result, 0, 0)?.v).toBe("#CYCLE!");
    expect(cell(result, 0, 2)?.v).toBe("#CYCLE!");
  });

  test("跨表引用重定位正确，原表内引用及字符串不误移动", () => {
    const engine = new SheetEngine([
      ...seed(),
      {
        id: "t",
        name: "Two",
        row: 2,
        column: 3,
        data: [
          [{ v: 7 }, { f: "=A1+One!A1" }, { f: '=IF(A1=7,"A1", "B1")' }],
          [null, null, null],
        ],
      },
    ]);
    const result = engine.dispatch("a", 0, "insert", [
      { type: "insertRows", sheetId: "s", index: 0, count: 1 },
    ]);
    expect(cell(result, 1, 1)?.f).toBe("=A2*3");
    expect(cell(result, 0, 1, "t")?.f).toBe("=A1+'One'!A2");
    expect(cell(result, 0, 1, "t")?.v).toBe(9);
    expect(cell(result, 0, 2, "t")?.f).toBe('=IF(A1=7,"A1", "B1")');
    expect(cell(result, 0, 2, "t")?.v).toBe("A1");
  });

  test("同格服务端 LWW，撤销本人旧写入保留他人输入与格式", () => {
    const engine = new SheetEngine(seed());
    engine.dispatch("a", 0, "a", [
      { type: "setCell", sheetId: "s", row: 1, column: 0, value: "A" },
    ]);
    engine.dispatch("b", 0, "b", [
      { type: "setCell", sheetId: "s", row: 1, column: 0, value: "B" },
    ]);
    engine.dispatch("b", 2, "format", [
      {
        type: "setCellFormat",
        sheetId: "s",
        row: 1,
        column: 0,
        format: { fc: "#ff0000" },
      },
    ]);
    const undo = engine.undo("a");
    expect(cell(undo, 1, 0)?.v).toBe("B");
    expect(cell(undo, 1, 0)?.fc).toBe("#ff0000");
    expect(cell(engine.redo("a"), 1, 0)?.v).toBe("B");
  });

  test("并发首位插入及旧坐标写入映射到原行，删除不会吞并发新增行", () => {
    const engine = new SheetEngine(seed());
    engine.dispatch("a", 0, "insert-a", [
      { type: "insertRows", sheetId: "s", index: 0, count: 1 },
    ]);
    engine.dispatch("b", 0, "insert-b", [
      { type: "insertRows", sheetId: "s", index: 0, count: 1 },
    ]);
    const written = engine.dispatch("c", 0, "write", [
      { type: "setCell", sheetId: "s", row: 0, column: 0, value: 10 },
    ]);
    expect(cell(written, 2, 0)?.v).toBe(10);
    expect(cell(written, 2, 1)?.v).toBe(30);
    const deleted = engine.dispatch("d", 0, "delete", [
      { type: "deleteRows", sheetId: "s", start: 0, end: 1 },
    ]);
    expect(deleted.workbook[0].row).toBe(4);
    expect(cell(deleted, 0, 0)).toBeNull();
    expect(cell(deleted, 1, 0)).toBeNull();
  });

  test("删除锚点后的旧修订插入由墓碑定位", () => {
    const engine = new SheetEngine(seed());
    engine.dispatch("a", 0, "delete", [
      { type: "deleteRows", sheetId: "s", start: 1, end: 1 },
    ]);
    const result = engine.dispatch("b", 0, "insert", [
      { type: "insertRows", sheetId: "s", index: 1, count: 1 },
    ]);
    expect(result.workbook[0].row).toBe(4);
    expect(cell(result, 0, 0)?.v).toBe(2);
    expect(cell(result, 1, 0)).toBeNull();
  });

  test("批次失败不提交任何状态，expectedRevision 拒绝旧 AI 批次", () => {
    const engine = new SheetEngine(seed()),
      before = engine.serialize();
    expect(() =>
      engine.dispatch(
        "ai",
        0,
        "invalid",
        [
          { type: "setCell", sheetId: "s", row: 1, column: 0, value: "x" },
          { type: "deleteRows", sheetId: "s", start: 0, end: 3 },
        ],
        { expectedRevision: 0 },
      ),
    ).toThrow();
    expect(engine.serialize()).toEqual(before);
    engine.dispatch("human", 0, "write", [
      { type: "setCell", sheetId: "s", row: 1, column: 0, value: "human" },
    ]);
    expect(() =>
      engine.dispatch(
        "ai",
        0,
        "stale",
        [{ type: "setCell", sheetId: "s", row: 1, column: 0, value: "ai" }],
        { expectedRevision: 0 },
      ),
    ).toThrow(SheetEngineError);
    expect(cell(engine.snapshot(), 1, 0)?.v).toBe("human");
  });

  test("原子 AI 多结构批次，序列化恢复后幂等与撤销继续生效", () => {
    const engine = new SheetEngine(seed());
    const operations = [
      { type: "insertRows" as const, sheetId: "s", index: 0, count: 1 },
      { type: "insertColumns" as const, sheetId: "s", index: 0, count: 1 },
      {
        type: "setCell" as const,
        sheetId: "s",
        row: 0,
        column: 0,
        value: "AI",
      },
    ];
    const result = engine.dispatch("ai", 0, "batch", operations, {
      expectedRevision: 0,
    });
    expect(cell(result, 0, 0)?.v).toBe("AI");
    expect(cell(result, 1, 2)?.f).toBe("=B2*3");
    const restored = SheetEngine.restore(engine.serialize());
    expect(restored.snapshot()).toEqual(result);
    expect(
      restored.dispatch("ai", 0, "batch", operations, { expectedRevision: 0 }),
    ).toEqual(result);
    expect(restored.revision).toBe(1);
    expect(restored.undo("ai").workbook[0].row).toBe(4);
    expect(restored.redo("ai").workbook[0].row).toBe(5);
  });

  test("整体恢复切换 epoch，拒绝旧会话重放", () => {
    const engine = new SheetEngine(seed());
    engine.dispatch("a", 0, "write", [
      { type: "setCell", sheetId: "s", row: 1, column: 0, value: "old" },
    ]);
    const restored = engine.replaceWorkbook(seed(), 1);
    expect(restored.epoch).toBe(2);
    expect(() =>
      engine.dispatch(
        "a",
        1,
        "pending",
        [{ type: "setCell", sheetId: "s", row: 1, column: 0, value: "stale" }],
        { epoch: 1 },
      ),
    ).toThrow(SheetEngineError);
    expect(() =>
      engine.dispatch("a", 1, "pending", [
        { type: "setCell", sheetId: "s", row: 1, column: 0, value: "stale" },
      ]),
    ).toThrow(SheetEngineError);
    expect(cell(engine.snapshot(), 1, 0)).toBeNull();
  });

  test("撤销本人新增行保留他人已经在该行写入的内容", () => {
    const engine = new SheetEngine(seed());
    engine.dispatch("a", 0, "insert", [
      { type: "insertRows", sheetId: "s", index: 1, count: 1 },
    ]);
    engine.dispatch("b", 1, "write", [
      { type: "setCell", sheetId: "s", row: 1, column: 0, value: "B" },
    ]);
    const undone = engine.undo("a");
    expect(undone.workbook[0].row).toBe(5);
    expect(cell(undone, 1, 0)?.v).toBe("B");
    expect(cell(engine.undo("b"), 1, 0)).toBeNull();
    expect(engine.snapshot().workbook[0].row).toBe(4);
    expect(cell(engine.redo("b"), 1, 0)?.v).toBe("B");
  });

  test("插入行个人撤销之后，其他会话旧修订仍可在其墓碑位置插入", () => {
    const engine = new SheetEngine(seed());
    engine.dispatch("a", 0, "insert", [
      { type: "insertRows", sheetId: "s", index: 1, count: 1 },
    ]);
    engine.undo("a");
    const added = engine.dispatch("b", 1, "insert-other", [
      { type: "insertRows", sheetId: "s", index: 1, count: 1 },
    ]);
    expect(added.workbook[0].row).toBe(5);
  });

  test("Fortune 操作适配丢弃结构派生旧公式，不允许整表覆盖", () => {
    const engine = new SheetEngine(seed());
    const result = engine.dispatch("a", 0, "native", [
      {
        op: "insertRowCol",
        id: "s",
        path: [],
        value: { type: "row", index: 0, count: 1, direction: "lefttop" },
      },
      {
        op: "replace",
        id: "s",
        path: ["data", 1, 1],
        value: { f: "=A999", v: 100 },
      },
      { op: "replace", id: "s", path: ["row"], value: 999 },
    ]);
    expect(cell(result, 1, 1)?.f).toBe("=A2*3");
    expect(result.workbook[0].row).toBe(5);
    expect(() =>
      engine.dispatch("a", 1, "overwrite", [
        { op: "replace", id: "s", path: ["data"], value: [] },
      ]),
    ).toThrow();
  });

  test("删除引用范围首行会收缩范围，绝对引用随结构正确移动", () => {
    const engine = new SheetEngine([
      {
        id: "s",
        name: "One",
        row: 4,
        column: 3,
        data: [
          [{ v: 1 }, { f: "=SUM(A1:A3)" }, { f: "=$A$1" }],
          [{ v: 2 }, null, null],
          [{ v: 3 }, null, null],
          [null, null, null],
        ],
      },
    ]);
    const removed = engine.dispatch("a", 0, "delete", [
      { type: "deleteRows", sheetId: "s", start: 1, end: 1 },
    ]);
    expect(cell(removed, 0, 1)?.f).toBe("=SUM(A1:A2)");
    expect(cell(removed, 0, 1)?.v).toBe(4);
    const moved = engine.dispatch("a", 1, "insert", [
      { type: "insertColumns", sheetId: "s", index: 0, count: 1 },
    ]);
    expect(cell(moved, 0, 3)?.f).toBe("=$B$1");
    expect(cell(moved, 0, 3)?.v).toBe(1);
  });

  test("旧修订公式写入根据原行定位，清除公式后不残留 f", () => {
    const engine = new SheetEngine(seed());
    engine.dispatch("a", 0, "insert", [
      { type: "insertRows", sheetId: "s", index: 0, count: 1 },
    ]);
    const written = engine.dispatch("b", 0, "formula", [
      {
        type: "setCell",
        sheetId: "s",
        row: 1,
        column: 0,
        value: { f: "=A1*5" },
      },
    ]);
    expect(cell(written, 2, 0)?.f).toBe("=A2*5");
    expect(cell(written, 2, 0)?.v).toBe(10);
    const plain = engine.dispatch("b", 2, "plain", [
      { type: "setCell", sheetId: "s", row: 2, column: 0, value: 9 },
    ]);
    expect(cell(plain, 2, 0)?.f).toBeUndefined();
    expect(cell(plain, 2, 0)?.v).toBe(9);
  });

  test("批量粘贴拆成稳定单元格操作，旧修订行高跟随原行", () => {
    const engine = new SheetEngine(seed());
    engine.dispatch("a", 0, "insert", [
      { type: "insertRows", sheetId: "s", index: 1, count: 1 },
    ]);
    const result = engine.dispatch("b", 0, "paste", [
      {
        op: "replace",
        id: "s",
        path: ["data", 1],
        value: [{ v: "P" }, { v: "Q" }],
      },
      { op: "replace", id: "s", path: ["config", "rowlen", "1"], value: 40 },
    ]);
    expect(cell(result, 2, 0)?.v).toBe("P");
    expect(cell(result, 2, 1)?.v).toBe("Q");
    expect(
      (result.workbook[0].config as Record<string, SheetJson>).rowlen,
    ).toEqual({ "2": 40 });
  });

  test("列移动保留稳定单元格与公式目标，结构个人撤销能恢复", () => {
    const engine = new SheetEngine(seed());
    const result = engine.dispatch("a", 0, "move", [
      { type: "moveColumns", sheetId: "s", start: 0, end: 0, before: 3 },
    ]);
    expect(cell(result, 0, 0)?.f).toBe("=C1*3");
    expect(cell(result, 0, 1)?.f).toBe("=A1+1");
    expect(cell(result, 0, 1)?.v).toBe(7);
    expect(cell(engine.undo("a"), 0, 1)?.f).toBe("=A1*3");
  });

  test("AI 内容局部写入保留格式，值和清空能移除旧公式", () => {
    const engine = new SheetEngine([
      {
        id: "s",
        name: "One",
        row: 3,
        column: 3,
        celldata: [
          { r: 0, c: 0, v: { f: "=1+2", fc: "#123456", bg: "#fedcba", bl: 1 } },
        ],
      },
    ]);
    engine.dispatch("ai", engine.revision, "content-value", [
      { type: "setCellContent", sheetId: "s", row: 0, column: 0, value: 8 },
    ]);
    const sheet = engine.snapshot().workbook[0]!;
    const cell = (sheet.data as Record<string, unknown>[][])[0]![0]!;
    expect(cell.v).toBe(8);
    expect(cell.f).toBeUndefined();
    expect(cell.fc).toBe("#123456");
    expect(cell.bg).toBe("#fedcba");
    expect(cell.bl).toBe(1);
    engine.dispatch("ai", engine.revision, "content-formula", [
      {
        type: "setCellContent",
        sheetId: "s",
        row: 0,
        column: 0,
        value: null,
        formula: "=5+5",
      },
    ]);
    expect(
      (
        engine.snapshot().workbook[0]!.data as Record<string, unknown>[][]
      )[0]![0]!.v,
    ).toBe(10);
    engine.dispatch("ai", engine.revision, "content-clear", [
      { type: "setCellContent", sheetId: "s", row: 0, column: 0, value: null },
    ]);
    const empty = (
      engine.snapshot().workbook[0]!.data as Record<string, unknown>[][]
    )[0]![0]!;
    expect(empty.v).toBeUndefined();
    expect(empty.f).toBeUndefined();
    expect(empty.fc).toBe("#123456");
  });
  test("非法对象字段和操作 ID 重用均不会改变状态", () => {
    const engine = new SheetEngine(seed());
    const operation = [
      {
        type: "setCell" as const,
        sheetId: "s",
        row: 1,
        column: 0,
        value: "safe",
      },
    ];
    engine.dispatch("a", 0, "id", operation);
    const before = engine.snapshot();
    expect(() =>
      engine.dispatch("a", 0, "id", [{ ...operation[0], value: "different" }]),
    ).toThrow();
    expect(() =>
      engine.dispatch("a", 1, "unsafe", [
        {
          op: "replace",
          id: "s",
          path: ["config", "__proto__", "x"],
          value: true,
        },
      ]),
    ).toThrow();
    expect(engine.snapshot()).toEqual(before);
  });
  test("事务 fork 不复制历史且候选失败或成功都不改原实例", () => {
    const original = new SheetEngine(seed());
    const serialized = original.serialize();
    const candidate = original.fork();
    expect(() =>
      candidate.dispatch("a", 0, "failed", [
        { type: "setCell", sheetId: "s", row: 0, column: 0, value: 8 },
        { type: "deleteSheet", sheetId: "s" },
      ]),
    ).toThrow();
    expect(original.serialize()).toEqual(serialized);
    candidate.dispatch("a", 0, "valid", [
      { type: "setCell", sheetId: "s", row: 0, column: 0, value: 8 },
    ]);
    expect(cell(candidate.snapshot(), 0, 0)?.v).toBe(8);
    expect(original.serialize()).toEqual(serialized);
  });
  test("修订撤销标记独立，旧视图写入定位未受后续撤销影响", () => {
    const engine = new SheetEngine(seed());
    engine.dispatch("a", 0, "insert", [
      { type: "insertRows", sheetId: "s", index: 0, count: 1 },
    ]);
    engine.undo("a");
    engine.dispatch("b", 1, "old-inserted-cell", [
      { type: "setCell", sheetId: "s", row: 0, column: 0, value: 88 },
    ]);
    expect(engine.snapshot().workbook[0]!.row).toBe(5);
    expect(cell(engine.snapshot(), 0, 0)?.v).toBe(88);
    expect(cell(engine.snapshot(), 1, 0)?.v).toBe(2);
  });
  test("新修订视图大小与工作簿非空单元格数量无关，旧持久格式可恢复", () => {
    const engine = new SheetEngine(seed());
    const legacy = engine.serialize() as Record<string, SheetJson>;
    legacy.views = [{ revision: 0, state: legacy.baseline! }];
    const restored = SheetEngine.restore(legacy);
    restored.dispatch("a", 0, "after-legacy", [
      { type: "setCell", sheetId: "s", row: 1, column: 0, value: 9 },
    ]);
    restored.dispatch("b", 0, "legacy-stale", [
      { type: "setCell", sheetId: "s", row: 2, column: 0, value: 10 },
    ]);
    expect(cell(restored.snapshot(), 2, 0)?.v).toBe(10);
    const stored = restored.serialize() as Record<string, SheetJson>;
    expect(
      JSON.stringify((stored.views as SheetJson[]).slice(1)).length,
    ).toBeLessThan(200);
    expect(SheetEngine.restore(stored).snapshot()).toEqual(restored.snapshot());
  });
  test("连续检查点压缩不切 epoch、不阻止编辑，过期重放拒绝且个人撤销保留他人输入", () => {
    const engine = new SheetEngine(seed(), {
      revisionWindow: 4,
      undoWindow: 3,
      historyWindow: 8,
    });
    for (let index = 0; index < 100; index++)
      engine.dispatch(index % 2 ? "a" : "b", engine.revision, `edit-${index}`, [
        { type: "setCell", sheetId: "s", row: 1, column: 0, value: index },
      ]);
    const stored = engine.serialize() as Record<string, SheetJson>;
    expect((stored.events as SheetJson[]).length).toBeLessThanOrEqual(8);
    expect((stored.views as SheetJson[]).length).toBe(5);
    expect((stored.accepted as SheetJson[]).length).toBeLessThanOrEqual(4);
    expect(engine.epoch).toBe(1);
    expect(() =>
      engine.dispatch("b", 0, "edit-0", [
        { type: "insertRows", sheetId: "s", index: 0, count: 1 },
      ]),
    ).toThrow();
    engine.undo("b");
    expect(cell(engine.snapshot(), 1, 0)?.v).toBe(99);
    engine.undo("a");
    expect(cell(engine.snapshot(), 1, 0)?.v).toBe(97);
    const resumed = SheetEngine.restore(engine.serialize());
    expect(resumed.snapshot()).toEqual(engine.snapshot());
    resumed.redo("a");
    expect(cell(resumed.snapshot(), 1, 0)?.v).toBe(99);
  });
  test("检查点冻结超出撤销窗口的被引用结构，窗口内来源撤销仍不吞他人内容", () => {
    const engine = new SheetEngine(seed(), {
      revisionWindow: 3,
      undoWindow: 2,
      historyWindow: 6,
    });
    engine.dispatch("creator", 0, "insert", [
      { type: "insertRows", sheetId: "s", index: 0, count: 1 },
    ]);
    engine.dispatch("writer", 1, "retain", [
      { type: "setCell", sheetId: "s", row: 0, column: 0, value: 88 },
    ]);
    engine.undo("creator");
    for (let index = 0; index < 10; index++)
      engine.dispatch("noise", engine.revision, `noise-${index}`, [
        { type: "setCell", sheetId: "s", row: 2, column: 2, value: index },
      ]);
    expect(cell(engine.snapshot(), 0, 0)?.v).toBe(88);
    expect(engine.snapshot().workbook[0]!.row).toBe(5);
    expect(() => engine.undo("writer")).toThrow("撤销窗口");
    expect(() => engine.redo("creator")).toThrow("撤销窗口");
    expect(SheetEngine.restore(engine.serialize()).snapshot()).toEqual(
      engine.snapshot(),
    );
    engine.dispatch("writer", engine.revision, "fresh", [
      { type: "setCell", sheetId: "s", row: 0, column: 0, value: 89 },
    ]);
    engine.undo("writer");
    expect(cell(engine.snapshot(), 0, 0)?.v).toBe(88);
  });

  test("超过4096修订的长期编辑自动压缩，离线旧来源不永久钉住日志", () => {
    const engine = new SheetEngine([
      { id: "long", name: "长期编辑", row: 2, column: 2, celldata: [] },
    ]);
    engine.dispatch("offline", 0, "old-insert", [
      { type: "insertRows", sheetId: "long", index: 0, count: 1 },
    ]);
    for (let index = 0; index < 4200; index++)
      engine.dispatch("online", engine.revision, `long-${index}`, [
        { type: "setCell", sheetId: "long", row: 1, column: 0, value: index },
      ]);
    const stored = engine.serialize() as Record<string, SheetJson>;
    expect((stored.events as SheetJson[]).length).toBeLessThanOrEqual(257);
    expect((stored.views as SheetJson[]).length).toBe(257);
    expect((stored.accepted as SheetJson[]).length).toBeLessThanOrEqual(256);
    expect(engine.epoch).toBe(1);
    expect(() => engine.undo("offline")).toThrow("撤销窗口");
    engine.undo("online");
    expect(cell(engine.snapshot(), 1, 0, "long")?.v).toBe(4198);
    expect(engine.snapshot().workbook[0]!.row).toBe(3);
    expect(SheetEngine.restore(engine.serialize()).snapshot()).toEqual(
      engine.snapshot(),
    );
  }, 60000);
  test("多次压缩后结构、公式与窗口内个人撤销仍与未压缩重放一致", () => {
    const compact = new SheetEngine(seed(), {
      revisionWindow: 4,
      undoWindow: 3,
      historyWindow: 12,
    });
    const reference = new SheetEngine(seed(), {
      revisionWindow: 4096,
      undoWindow: 4096,
      historyWindow: 4096,
    });
    for (let index = 0; index < 120; index++) {
      const rows = Number(compact.snapshot().workbook[0]!.row);
      const operation =
        index % 10 === 0
          ? { type: "insertRows" as const, sheetId: "s", index: 1, count: 1 }
          : index % 11 === 0 && rows > 4
            ? {
                type: "deleteRows" as const,
                sheetId: "s",
                start: rows - 1,
                end: rows - 1,
              }
            : {
                type: "setCell" as const,
                sheetId: "s",
                row: index % rows,
                column: 0,
                value: index + 5,
              };
      const source = index % 2 ? "one" : "two";
      compact.dispatch(source, compact.revision, `compare-${index}`, [
        operation,
      ]);
      reference.dispatch(source, reference.revision, `compare-${index}`, [
        operation,
      ]);
      if (index % 7 === 0) {
        compact.undo(source);
        reference.undo(source);
      }
      expect(compact.snapshot()).toEqual(reference.snapshot());
      expect(SheetEngine.restore(compact.serialize()).snapshot()).toEqual(
        compact.snapshot(),
      );
    }
    expect(SheetEngine.restore(compact.serialize()).snapshot()).toEqual(
      reference.snapshot(),
    );
  });
  test("固定随机并发旧坐标、行列墓碑、公式与个人撤销保持完整重放一致", () => {
    const engine = new SheetEngine(seed(), {
      revisionWindow: 8,
      undoWindow: 4,
      historyWindow: 20,
    });
    const recent = [engine.snapshot()];
    let randomState = 0x56348;
    const random = (max: number) => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState % max;
    };
    for (let index = 0; index < 240; index++) {
      const before = engine.snapshot();
      const source = `source-${random(3)}`;
      const choice = random(8);
      if (choice === 0 || choice === 1) {
        try {
          choice === 0 ? engine.undo(source) : engine.redo(source);
        } catch (error) {
          expect(error).toBeInstanceOf(SheetEngineError);
          expect((error as SheetEngineError).code).toBe("UNDO_WINDOW_EXPIRED");
          expect(engine.snapshot()).toEqual(before);
        }
      } else {
        const base = recent[random(recent.length)]!;
        const sheet = base.workbook[0]!;
        const rows = Number(sheet.row),
          columns = Number(sheet.column);
        const operation =
          choice === 2 && rows < 12
            ? {
                type: "insertRows" as const,
                sheetId: "s",
                index: random(rows),
                count: 1,
              }
            : choice === 3 && columns < 8
              ? {
                  type: "insertColumns" as const,
                  sheetId: "s",
                  index: random(columns),
                  count: 1,
                }
              : choice === 4 && rows > 3 && Number(before.workbook[0]!.row) > 3
                ? {
                    type: "deleteRows" as const,
                    sheetId: "s",
                    start: rows - 1,
                    end: rows - 1,
                  }
                : choice === 5 &&
                    columns > 3 &&
                    Number(before.workbook[0]!.column) > 3
                  ? {
                      type: "deleteColumns" as const,
                      sheetId: "s",
                      start: columns - 1,
                      end: columns - 1,
                    }
                  : {
                      type: "setCellContent" as const,
                      sheetId: "s",
                      row: random(rows),
                      column: random(columns),
                      value: index,
                      ...(choice === 6
                        ? { value: null, formula: "=SUM(A1:A2)" }
                        : {}),
                    };
        engine.dispatch(source, base.revision, `random-${index}`, [operation]);
      }
      expect(SheetEngine.restore(engine.serialize()).snapshot()).toEqual(
        engine.snapshot(),
      );
      recent.push(engine.snapshot());
      if (recent.length > 3) recent.shift();
    }
  });
});
