import { createHash, randomUUID } from "node:crypto";
import {
  defaultContext,
  deleteRowCol,
  execfunction,
  insertRowCol,
  is_date as isDateFormat,
  update as formatNumber,
} from "@fortune-sheet/core";
import type { Context, Sheet } from "@fortune-sheet/core";
import { sheetCollaborationConfig } from "../../../../../config/sheet-collaboration";

export type SheetJson =
  null | boolean | number | string | SheetJson[] | { [key: string]: SheetJson };
type ObjectValue = { [key: string]: SheetJson };
type AxisName = "row" | "column";
type AxisItem = { id: string; deleted: boolean };
type Ref = {
  start: number;
  end: number;
  sheet: string;
  row?: string;
  column?: string;
  rowEnd?: string;
  columnEnd?: string;
  rowAbsolute: boolean;
  columnAbsolute: boolean;
  rowEndAbsolute: boolean;
  columnEndAbsolute: boolean;
  prefix: string;
};
type Formula = { source: string; refs: Ref[] };
type CellState = { attributes: ObjectValue; formula?: Formula };
type InternalSheet = {
  metadata: ObjectValue;
  rows: AxisItem[];
  columns: AxisItem[];
  cells: Record<string, CellState>;
  deleted: boolean;
};
type BookState = { sheets: InternalSheet[] };
type CellCommand = {
  type: "cell";
  sheet: string;
  row: string;
  column: string;
  attributes: ObjectValue;
  remove: string[];
  formula?: Formula;
  removeFormula: boolean;
};
type InsertCommand = {
  type: "insert";
  sheet: string;
  axis: AxisName;
  anchor?: string;
  items: string[];
};
type DeleteCommand = {
  type: "delete";
  sheet: string;
  axis: AxisName;
  targets: string[];
};
type MoveCommand = {
  type: "move";
  sheet: string;
  axis: AxisName;
  targets: string[];
  anchor?: string;
};
type PropertyCommand = {
  type: "property";
  sheet: string;
  path: (string | number)[];
  value?: SheetJson;
  remove: boolean;
  axisKey?: { axis: AxisName; id: string };
  coordinateAxes?: { rows: string[]; columns: string[] };
};
type Command =
  | CellCommand
  | InsertCommand
  | DeleteCommand
  | MoveCommand
  | PropertyCommand
  | { type: "addSheet"; sheet: InternalSheet }
  | { type: "deleteSheet"; sheet: string };
type Event = {
  id: string;
  session: string;
  commands: Command[];
  active: boolean;
  redoable: boolean;
  undoneAt?: number;
  revision?: number;
};
type RevisionView =
  | { revision: number; state: BookState }
  | { revision: number; eventCount: number; inactive: number[] };
type Accepted = { key: string; fingerprint: string; revision: number };
type Stored = {
  schema: 1;
  epoch: number;
  revision: number;
  baseline: BookState;
  events: Event[];
  views: RevisionView[];
  accepted: Accepted[];
  expiredUndoSources?: string[];
  expiredRedoSources?: string[];
};

export type SheetCommand =
  | {
      type: "setCellContent";
      sheetId: string;
      row: number;
      column: number;
      value: SheetJson;
      formula?: string;
    }
  | {
      type: "setCell";
      sheetId: string;
      row: number;
      column: number;
      value: SheetJson;
    }
  | {
      type: "setCellFormat";
      sheetId: string;
      row: number;
      column: number;
      format: ObjectValue;
    }
  | {
      type: "insertRows" | "insertColumns";
      sheetId: string;
      index: number;
      count: number;
    }
  | {
      type: "deleteRows" | "deleteColumns";
      sheetId: string;
      start: number;
      end: number;
    }
  | {
      type: "moveRows" | "moveColumns";
      sheetId: string;
      start: number;
      end: number;
      before: number;
    }
  | { type: "addSheet"; sheet: ObjectValue }
  | { type: "deleteSheet"; sheetId: string }
  | { type: "renameSheet"; sheetId: string; name: string };

export type FortuneOperation = {
  op:
    | "replace"
    | "add"
    | "remove"
    | "insertRowCol"
    | "deleteRowCol"
    | "addSheet"
    | "deleteSheet";
  id: string;
  path: (string | number)[];
  value?: unknown;
};
export type SheetEngineSnapshot = {
  epoch: number;
  revision: number;
  workbook: ObjectValue[];
};
export class SheetEngineError extends Error {
  constructor(
    readonly code:
      | "INVALID_OPERATION"
      | "REVISION_CONFLICT"
      | "EPOCH_CONFLICT"
      | "OPERATION_ID_CONFLICT"
      | "UNDO_WINDOW_EXPIRED"
      | "CONTENT_TOO_LARGE"
      | "MESSAGE_TOO_LARGE",
    message: string,
  ) {
    super(message);
  }
}
const bad = (message: string): never => {
  throw new SheetEngineError("INVALID_OPERATION", message);
};
const conflict = (): never => {
  throw new SheetEngineError("REVISION_CONFLICT", "表格修订已变化，请重新读取");
};
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const derivedProperties = new Set([
  "calcChain",
  "celldata",
  "luckysheet_select_save",
  "luckysheet_selection_range",
  "status",
]);
const maxCells = 300_000;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return bad("对象格式无效");
  return value as ObjectValue;
}
function json(value: unknown): SheetJson {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(json);
  const next: ObjectValue = {};
  for (const [key, item] of Object.entries(object(value))) {
    if (forbidden.has(key)) return bad("非法对象字段");
    next[key] = json(item);
  }
  return next;
}
function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    return bad("行列范围无效");
  return value;
}
const active = (items: AxisItem[]) => items.filter((item) => !item.deleted);
const keyOf = (row: string, column: string) => `${row}:${column}`;
function findSheet(state: BookState, id: string): InternalSheet {
  const sheet = state.sheets.find(
    (entry) => entry.metadata.id === id && !entry.deleted,
  );
  if (!sheet) return bad("工作表不存在");
  return sheet;
}
function axis(sheet: InternalSheet, name: AxisName) {
  return name === "row" ? sheet.rows : sheet.columns;
}
function columnIndex(text: string) {
  let value = 0;
  for (const letter of text.toUpperCase())
    value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}
function columnName(index: number) {
  let value = index + 1,
    result = "";
  while (value > 0) {
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

/** 引用只在提交时由该客户端修订转换为稳定地址；字符串内容不作为引用。 */
function parseFormula(
  source: string,
  owner: InternalSheet,
  state: BookState,
): Formula {
  if (source.length > 16_384 || !source.startsWith("="))
    return bad("公式格式无效");
  const refs: Ref[] = [];
  const reference =
    /^(?:(('(?:[^']|'')+'|[\p{L}_][\p{L}\p{N}_.]*)!)?)(\$?[A-Za-z]{1,3}\$?[1-9]\d*|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?[1-9]\d*:\$?[1-9]\d*)(?::(\$?[A-Za-z]{1,3}\$?[1-9]\d*))?/u;
  for (let index = 1; index < source.length;) {
    if (source[index] === '"') {
      index++;
      while (index < source.length) {
        if (source[index++] === '"') {
          if (source[index] === '"') index++;
          else break;
        }
      }
      continue;
    }
    if (index > 1 && /[\p{L}\p{N}_.$]/u.test(source[index - 1])) {
      index++;
      continue;
    }
    const match = reference.exec(source.slice(index));
    if (
      !match ||
      /[\p{L}\p{N}_]/u.test(source[index + match[0].length] ?? "") ||
      source[index + match[0].length] === "("
    ) {
      index++;
      continue;
    }
    const prefix = match[1] ?? "";
    const rawName = match[2];
    const name = rawName?.startsWith("'")
      ? rawName.slice(1, -1).replace(/''/g, "'")
      : rawName;
    const target =
      name === undefined
        ? owner
        : state.sheets.find(
            (sheet) => sheet.metadata.name === name && !sheet.deleted,
          );
    if (!target) {
      index += match[0].length;
      continue;
    }
    let first = match[3],
      last = match[4];
    if (first.includes(":")) [first, last] = first.split(":");
    const coordinate = (text: string) => {
      const cell = /^(\$?)([A-Za-z]+)?(\$?)([1-9]\d*)?$/.exec(text);
      if (!cell) return bad("公式引用无效");
      return {
        row: cell[4] ? active(target.rows)[Number(cell[4]) - 1]?.id : undefined,
        column: cell[2]
          ? active(target.columns)[columnIndex(cell[2])]?.id
          : undefined,
        ra: cell[3] === "$" || (!cell[2] && cell[1] === "$"),
        ca: cell[1] === "$",
      };
    };
    const start = coordinate(first),
      end = last ? coordinate(last) : start;
    // 超出已分配工作表的地址继续留为文本，解析器会返回其原生错误值。
    if (
      (!start.row && /\d/.test(first)) ||
      (!start.column && /[a-z]/i.test(first)) ||
      (last &&
        ((!end.row && /\d/.test(last)) || (!end.column && /[a-z]/i.test(last))))
    ) {
      index += match[0].length;
      continue;
    }
    refs.push({
      start: index,
      end: index + match[0].length,
      sheet: String(target.metadata.id),
      row: start.row,
      column: start.column,
      rowEnd: last ? end.row : undefined,
      columnEnd: last ? end.column : undefined,
      rowAbsolute: start.ra,
      columnAbsolute: start.ca,
      rowEndAbsolute: end.ra,
      columnEndAbsolute: end.ca,
      prefix,
    });
    index += match[0].length;
  }
  return { source, refs };
}

function referenceCoordinates(ref: Ref, state: BookState) {
  const sheet = state.sheets.find(
    (entry) => entry.metadata.id === ref.sheet && !entry.deleted,
  );
  if (!sheet) return undefined;
  const resolve = (items: AxisItem[], first?: string, last?: string) => {
    const visible = active(items);
    if (!first) return [0, visible.length - 1];
    if (!last) {
      const index = visible.findIndex((item) => item.id === first);
      return index < 0 ? undefined : [index, index];
    }
    const start = items.findIndex((item) => item.id === first),
      end = items.findIndex((item) => item.id === last);
    if (start < 0 || end < start) return undefined;
    const included = new Set(
      items
        .slice(start, end + 1)
        .filter((item) => !item.deleted)
        .map((item) => item.id),
    );
    const indices = visible.flatMap((item, index) =>
      included.has(item.id) ? [index] : [],
    );
    return indices.length
      ? [indices[0], indices[indices.length - 1]]
      : undefined;
  };
  const row = resolve(sheet.rows, ref.row, ref.rowEnd),
    column = resolve(sheet.columns, ref.column, ref.columnEnd);
  return row && column ? { sheet, row, column } : undefined;
}

function renderFormula(formula: Formula, state: BookState): string {
  let result = formula.source;
  for (const ref of [...formula.refs].reverse()) {
    const target = referenceCoordinates(ref, state);
    let text = "#REF!";
    if (target) {
      const name = String(target.sheet.metadata.name).replace(/'/g, "''");
      const prefix = ref.prefix ? `'${name}'!` : "";
      const coordinate = (r: number, c: number, ra: boolean, ca: boolean) =>
        `${ref.column ? (ca ? "$" : "") + columnName(c) : ""}${ref.row ? (ra ? "$" : "") + (r + 1) : ""}`;
      const first = coordinate(
        target.row[0],
        target.column[0],
        ref.rowAbsolute,
        ref.columnAbsolute,
      );
      const last = coordinate(
        target.row[1],
        target.column[1],
        ref.rowEndAbsolute,
        ref.columnEndAbsolute,
      );
      text = prefix + first + (ref.rowEnd || ref.columnEnd ? `:${last}` : "");
    }
    result = result.slice(0, ref.start) + text + result.slice(ref.end);
  }
  return result;
}

function initBook(input: unknown): BookState {
  if (!Array.isArray(input) || input.length < 1 || input.length > 30)
    return bad("工作表数量必须为 1–30");
  const ids = new Set<string>(),
    names = new Set<string>();
  const state: BookState = {
    sheets: input.map((value) => {
      const metadata = object(json(value));
      const id = metadata.id,
        name = metadata.name;
      if (typeof id !== "string" || !id || id.length > 100 || ids.has(id))
        return bad("工作表 ID 无效或重复");
      if (
        typeof name !== "string" ||
        !name ||
        name.length > 100 ||
        names.has(name)
      )
        return bad("工作表名称无效或重复");
      ids.add(id);
      names.add(name);
      const dense = Array.isArray(metadata.data) ? metadata.data : undefined;
      const rows = integer(metadata.row ?? dense?.length ?? 200, 1, 10_000);
      const columns = integer(
        metadata.column ??
          (dense?.[0] as SheetJson[] | undefined)?.length ??
          26,
        1,
        1000,
      );
      if (rows * columns > maxCells) return bad("工作表单元格数量超限");
      const sheet: InternalSheet = {
        metadata,
        rows: Array.from({ length: rows }, () => ({
          id: randomUUID(),
          deleted: false,
        })),
        columns: Array.from({ length: columns }, () => ({
          id: randomUUID(),
          deleted: false,
        })),
        cells: {},
        deleted: false,
      };
      const put = (r: number, c: number, raw: SheetJson) => {
        integer(r, 0, rows - 1);
        integer(c, 0, columns - 1);
        if (raw === null) return;
        const attributes =
          typeof raw === "object" && !Array.isArray(raw)
            ? structuredClone(raw)
            : { v: raw };
        sheet.cells[keyOf(sheet.rows[r].id, sheet.columns[c].id)] = {
          attributes,
        };
      };
      if (dense)
        dense.forEach((row, r) => {
          if (!Array.isArray(row)) return bad("单元格矩阵无效");
          row.forEach((cell, c) => put(r, c, cell));
        });
      else if (Array.isArray(metadata.celldata))
        metadata.celldata.forEach((entry) => {
          const cell = object(entry);
          put(Number(cell.r), Number(cell.c), cell.v ?? null);
        });
      delete metadata.data;
      delete metadata.celldata;
      delete metadata.calcChain;
      return sheet;
    }),
  };
  for (const sheet of state.sheets)
    for (const cell of Object.values(sheet.cells)) {
      if (typeof cell.attributes.f === "string")
        cell.formula = parseFormula(cell.attributes.f, sheet, state);
    }
  return state;
}

function addSheet(value: unknown, state: BookState): Command[] {
  const sheet = initBook([value]).sheets[0];
  if (state.sheets.some((entry) => entry.metadata.id === sheet.metadata.id))
    return bad("工作表 ID 已存在");
  const combined = { sheets: [...state.sheets, sheet] };
  for (const cell of Object.values(sheet.cells))
    if (typeof cell.attributes.f === "string")
      cell.formula = parseFormula(cell.attributes.f, sheet, combined);
  return [{ type: "addSheet", sheet }];
}

/** 修订只保留当时事件前缀和撤销标记；单元格与稳定轴从基线重放恢复。 */
function revisionView(revision: number, events: Event[]): RevisionView {
  return {
    revision,
    eventCount: events.length,
    inactive: events.flatMap((event, index) => (event.active ? [] : [index])),
  };
}

function headless(workbook: ObjectValue[]): Context {
  const context = defaultContext({
    globalCache: { undoList: [], redoList: [] },
    cellInput: { current: null },
    fxInput: { current: null },
    canvas: { current: null },
    cellArea: { current: null },
    workbookContainer: { current: null },
  });
  context.luckysheetfile = workbook as unknown as Sheet[];
  context.currentSheetId = String(workbook[0].id);
  return context;
}

function formatCellDisplay(value: ObjectValue): void {
  if (
    typeof value.v !== "number" ||
    !value.ct ||
    typeof value.ct !== "object" ||
    Array.isArray(value.ct) ||
    typeof value.ct.fa !== "string"
  )
    return;
  try {
    // 显示值由 Fortune 同一数字格式引擎生成，不能信任导入或旧快照中的缓存 m。
    value.m = String(formatNumber(value.ct.fa, value.v));
    value.ct.t = isDateFormat(value.ct.fa, value.v) ? "d" : "n";
  } catch {
    value.m = String(value.v);
  }
}

function project(state: BookState, calculate = true): ObjectValue[] {
  const workbook = state.sheets
    .filter((sheet) => !sheet.deleted)
    .map((sheet) => {
      const rows = active(sheet.rows),
        columns = active(sheet.columns);
      const metadata = structuredClone(sheet.metadata);
      metadata.row = rows.length;
      metadata.column = columns.length;
      const chain: ObjectValue[] = [];
      metadata.data = rows.map((row, r) =>
        columns.map((column, c) => {
          const cell = sheet.cells[keyOf(row.id, column.id)];
          if (!cell || !Object.keys(cell.attributes).length) return null;
          const value = structuredClone(cell.attributes);
          formatCellDisplay(value);
          if (cell.formula) {
            value.f = renderFormula(cell.formula, state);
            chain.push({ r, c, id: String(metadata.id) });
          }
          return value;
        }),
      );
      metadata.calcChain = chain;
      return metadata;
    });
  if (!calculate) return workbook;
  const ctx = headless(workbook),
    visiting = new Set<string>(),
    completed = new Set<string>();
  let visitedReferences = 0;
  const evaluate = (sheet: InternalSheet, r: number, c: number): void => {
    const id = String(sheet.metadata.id),
      signature = `${id}:${r}:${c}`;
    if (completed.has(signature)) return;
    const rows = active(sheet.rows),
      columns = active(sheet.columns);
    const entry = sheet.cells[keyOf(rows[r]?.id ?? "", columns[c]?.id ?? "")];
    if (!entry?.formula) return;
    const targetSheet = workbook.find((item) => item.id === id)!;
    const value = object((targetSheet.data as SheetJson[][])[r][c]);
    if (visiting.has(signature)) {
      value.v = "#CYCLE!";
      value.m = "#CYCLE!";
      return;
    }
    visiting.add(signature);
    let cycle = false;
    for (const ref of entry.formula.refs) {
      const coordinates = referenceCoordinates(ref, state);
      if (!coordinates) continue;
      for (let row = coordinates.row[0]; row <= coordinates.row[1]; row++)
        for (
          let column = coordinates.column[0];
          column <= coordinates.column[1];
          column++
        ) {
          if (++visitedReferences > 1_000_000) return bad("公式依赖数量超限");
          const dependency = `${coordinates.sheet.metadata.id}:${row}:${column}`;
          if (visiting.has(dependency)) cycle = true;
          evaluate(coordinates.sheet, row, column);
          const depSheet = workbook.find(
            (item) => item.id === coordinates.sheet.metadata.id,
          )!;
          const dep = (depSheet.data as SheetJson[][])[row]?.[column];
          if (
            dep &&
            typeof dep === "object" &&
            !Array.isArray(dep) &&
            dep.v === "#CYCLE!"
          )
            cycle = true;
        }
    }
    let computed: SheetJson;
    if (cycle) computed = "#CYCLE!";
    else {
      try {
        computed = json(
          execfunction(
            ctx,
            String(value.f),
            r,
            c,
            id,
            undefined,
            false,
            true,
          )[1] ?? null,
        );
      } catch {
        computed = "#ERROR!";
      }
    }
    value.v = computed;
    value.m = computed === null ? "" : String(computed);
    formatCellDisplay(value);
    visiting.delete(signature);
    completed.add(signature);
  };
  for (const sheet of state.sheets.filter((entry) => !entry.deleted))
    active(sheet.rows).forEach((_, r) =>
      active(sheet.columns).forEach((__, c) => evaluate(sheet, r, c)),
    );
  return workbook;
}

function applyProperty(sheet: InternalSheet, command: PropertyCommand) {
  let path = command.path;
  if (command.axisKey) {
    const index = active(axis(sheet, command.axisKey.axis)).findIndex(
      (item) => item.id === command.axisKey!.id,
    );
    if (index < 0) return;
    path = [...path.slice(0, -1), String(index)];
  }
  let parent: ObjectValue | SheetJson[] = sheet.metadata;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const record = parent as ObjectValue;
    if (record[key] === undefined)
      record[key] = typeof path[i + 1] === "number" ? [] : {};
    const next = record[key];
    if (!next || typeof next !== "object") return bad("配置路径无效");
    parent = next;
  }
  const record = parent as ObjectValue,
    final = path[path.length - 1];
  if (command.remove) delete record[final];
  else
    record[final] = command.coordinateAxes
      ? rebaseMetadata(
          command.value ?? null,
          command.path,
          command.coordinateAxes,
          sheet,
        )
      : structuredClone(command.value ?? null);
}

function rebaseMetadata(
  value: SheetJson,
  path: (string | number)[],
  previous: { rows: string[]; columns: string[] },
  sheet: InternalSheet,
): SheetJson {
  const rows = active(sheet.rows).map((entry) => entry.id),
    columns = active(sheet.columns).map((entry) => entry.id);
  const changed =
    JSON.stringify(previous.rows) !== JSON.stringify(rows) ||
    JSON.stringify(previous.columns) !== JSON.stringify(columns);
  if (!changed) return structuredClone(value);
  const position = (index: number, name: AxisName) =>
    (name === "row" ? rows : columns).indexOf(
      (name === "row" ? previous.rows : previous.columns)[index],
    );
  const range = (raw: SheetJson, name: AxisName): SheetJson => {
    if (!Array.isArray(raw) || raw.length !== 2) return bad("配置范围无效");
    const a = integer(
        raw[0],
        0,
        (name === "row" ? previous.rows : previous.columns).length - 1,
      ),
      b = integer(
        raw[1],
        a,
        (name === "row" ? previous.rows : previous.columns).length - 1,
      );
    const included = (name === "row" ? previous.rows : previous.columns).slice(
      a,
      b + 1,
    );
    const indices = included
      .map((id) => (name === "row" ? rows : columns).indexOf(id))
      .filter((index) => index >= 0);
    return indices.length ? [Math.min(...indices), Math.max(...indices)] : null;
  };
  const walk = (item: SheetJson): SheetJson => {
    if (Array.isArray(item)) return item.map(walk);
    if (!item || typeof item !== "object") return item;
    const out: ObjectValue = {};
    for (const [key, child] of Object.entries(item))
      out[key] =
        (key === "row" || key === "column") &&
        Array.isArray(child) &&
        child.length === 2
          ? range(child, key)
          : walk(child);
    return out;
  };
  const dictionary = (
    item: SheetJson,
    kind: "row" | "column" | "cell" | "merge",
  ): SheetJson => {
    const out: ObjectValue = {};
    for (const [key, child] of Object.entries(object(item))) {
      if (kind === "row" || kind === "column") {
        const index = position(Number(key), kind);
        if (index >= 0) out[index] = structuredClone(child);
      } else {
        const coordinates = key.split("_").map(Number),
          r = position(coordinates[0], "row"),
          c = position(coordinates[1], "column");
        if (r < 0 || c < 0) continue;
        if (kind === "merge") {
          const merge = object(child),
            rr = range(
              [Number(merge.r), Number(merge.r) + Number(merge.rs) - 1],
              "row",
            ),
            cc = range(
              [Number(merge.c), Number(merge.c) + Number(merge.cs) - 1],
              "column",
            );
          if (!Array.isArray(rr) || !Array.isArray(cc)) continue;
          out[`${rr[0]}_${cc[0]}`] = {
            r: Number(rr[0]),
            c: Number(cc[0]),
            rs: Number(rr[1]) - Number(rr[0]) + 1,
            cs: Number(cc[1]) - Number(cc[0]) + 1,
          };
        } else out[`${r}_${c}`] = walk(child);
      }
    }
    return out;
  };
  const property = String(path[path.length - 1]);
  if (["rowlen", "rowhidden", "rowReadOnly", "customHeight"].includes(property))
    return dictionary(value, "row");
  if (["columnlen", "colhidden", "colReadOnly"].includes(property))
    return dictionary(value, "column");
  if (property === "merge") return dictionary(value, "merge");
  if (property === "hyperlink" || property === "dataVerification")
    return dictionary(value, "cell");
  if (property === "config") {
    const config = object(value),
      result: ObjectValue = {};
    for (const [key, child] of Object.entries(config))
      result[key] = rebaseMetadata(child, [...path, key], previous, sheet);
    return result;
  }
  if (property === "filter" || property === "images")
    return bad("旧修订的筛选条件或图片位置无法安全重定位，请重新读取后设置");
  return walk(value);
}

/** 结构变动使用上游元数据变换，公式及单元格由稳定地址重建，避免跨表误移。 */
function structural(
  state: BookState,
  sheet: InternalSheet,
  name: AxisName,
  index: number,
  count: number,
  insert: boolean,
) {
  const workbook = project(state, false);
  for (const entry of workbook) {
    entry.calcChain = [];
    for (const row of entry.data as SheetJson[][])
      for (const cell of row)
        if (cell && typeof cell === "object" && !Array.isArray(cell))
          delete cell.f;
  }
  const ctx = headless(workbook),
    id = String(sheet.metadata.id);
  if (insert)
    insertRowCol(
      ctx,
      { type: name, index, count, direction: "lefttop", id },
      false,
    );
  else
    deleteRowCol(ctx, { type: name, start: index, end: index + count - 1, id });
  const output = workbook.find((entry) => entry.id === id)!;
  delete output.data;
  delete output.calcChain;
  sheet.metadata = output;
}

function replay(
  baseline: BookState,
  events: Event[],
  retentionContext = events,
): BookState {
  const state = structuredClone(baseline);
  const referencedByOthers = (
    event: Event,
    sheetId: string,
    name?: AxisName,
    ids?: string[],
  ) => {
    const target = new Set(ids);
    return retentionContext.some(
      (other) =>
        other.active &&
        other.session !== event.session &&
        other.commands.some((command) => {
          if (command.type === "addSheet" || command.sheet !== sheetId)
            return false;
          if (!name) return true;
          if (command.type === "cell")
            return target.has(name === "row" ? command.row : command.column);
          if (command.type === "property")
            return (
              command.axisKey?.axis === name && target.has(command.axisKey.id)
            );
          return false;
        }),
    );
  };
  for (const event of events)
    for (const command of event.commands) {
      if (command.type === "addSheet") {
        if (
          !state.sheets.some(
            (sheet) => sheet.metadata.id === command.sheet.metadata.id,
          )
        ) {
          const sheet = structuredClone(command.sheet);
          sheet.deleted =
            !event.active &&
            !referencedByOthers(event, String(sheet.metadata.id));
          state.sheets.push(sheet);
        }
        continue;
      }
      const sheetId = command.sheet;
      const sheet = state.sheets.find(
        (entry) => entry.metadata.id === sheetId && !entry.deleted,
      );
      if (!sheet) continue;
      if (!event.active && command.type !== "insert") continue;
      if (command.type === "deleteSheet") {
        if (state.sheets.filter((entry) => !entry.deleted).length === 1)
          return bad("至少保留一张工作表");
        sheet.deleted = true;
        continue;
      }
      if (command.type === "cell") {
        const key = keyOf(command.row, command.column),
          cell = sheet.cells[key] ?? { attributes: {} };
        for (const attribute of command.remove)
          delete cell.attributes[attribute];
        Object.assign(cell.attributes, structuredClone(command.attributes));
        if (command.removeFormula) {
          delete cell.formula;
          delete cell.attributes.f;
        }
        if (command.formula) cell.formula = structuredClone(command.formula);
        sheet.cells[key] = cell;
      } else if (command.type === "property") applyProperty(sheet, command);
      else if (command.type === "insert") {
        const items = axis(sheet, command.axis);
        const position =
          command.anchor === undefined
            ? items.length
            : items.findIndex((item) => item.id === command.anchor);
        if (position < 0) return bad("结构操作定位点不存在");
        const visiblePosition = items
          .slice(0, position)
          .filter((item) => !item.deleted).length;
        const retained =
          event.active ||
          referencedByOthers(event, sheetId, command.axis, command.items);
        if (retained)
          structural(
            state,
            sheet,
            command.axis,
            visiblePosition,
            command.items.length,
            true,
          );
        items.splice(
          position,
          0,
          ...command.items.map((id) => ({ id, deleted: !retained })),
        );
      } else if (command.type === "delete") {
        const items = axis(sheet, command.axis),
          targets = new Set(command.targets);
        const indices = active(items)
          .flatMap((item, index) => (targets.has(item.id) ? [index] : []))
          .reverse();
        if (indices.length >= active(items).length)
          return bad("至少保留一行一列");
        for (const index of indices)
          structural(state, sheet, command.axis, index, 1, false);
        for (const item of items) if (targets.has(item.id)) item.deleted = true;
      } else if (command.type === "move") {
        const items = axis(sheet, command.axis),
          target = new Set(command.targets);
        if (command.anchor && target.has(command.anchor)) continue;
        const moved = items.filter((item) => target.has(item.id));
        const remaining = items.filter((item) => !target.has(item.id));
        const position =
          command.anchor === undefined
            ? remaining.length
            : remaining.findIndex((item) => item.id === command.anchor);
        if (position < 0) return bad("移动定位点不存在");
        remaining.splice(position, 0, ...moved);
        if (command.axis === "row") sheet.rows = remaining;
        else sheet.columns = remaining;
        remapMovedMetadata(sheet, items, remaining, command.axis);
      }
    }
  const live = state.sheets.filter((sheet) => !sheet.deleted),
    names = new Set<string>();
  if (!live.length || live.length > 30) return bad("工作表数量超限");
  for (const sheet of live) {
    const rows = active(sheet.rows).length,
      columns = active(sheet.columns).length;
    if (
      !rows ||
      !columns ||
      rows > 10_000 ||
      columns > 1000 ||
      rows * columns > maxCells
    )
      return bad("工作表规模超限");
    const name = String(sheet.metadata.name);
    if (!name || name.length > 100 || names.has(name))
      return bad("工作表名称无效或重复");
    names.add(name);
  }
  return state;
}

function remapMovedMetadata(
  sheet: InternalSheet,
  previous: AxisItem[],
  next: AxisItem[],
  name: AxisName,
) {
  const configuration = sheet.metadata.config;
  if (
    configuration &&
    typeof configuration === "object" &&
    !Array.isArray(configuration)
  ) {
    for (const property of name === "row"
      ? ["rowlen", "rowhidden", "rowReadOnly", "customHeight"]
      : ["columnlen", "colhidden", "colReadOnly"]) {
      const value = configuration[property];
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const mapped: ObjectValue = {};
      for (const [key, item] of Object.entries(value)) {
        const id = active(previous)[Number(key)]?.id;
        const index = active(next).findIndex((entry) => entry.id === id);
        if (index >= 0) mapped[index] = item;
      }
      configuration[property] = mapped;
    }
    // 移动合并区域会改变其连续性，需显式拒绝而不是保留错误矩形。
    if (configuration.merge && Object.keys(object(configuration.merge)).length)
      return bad("含合并区域的行列移动暂不支持，请先取消合并");
  }
  if (
    sheet.metadata.filter_select ||
    sheet.metadata.dataVerification ||
    sheet.metadata.luckysheet_conditionformat_save ||
    sheet.metadata.images
  ) {
    const hasData = [
      sheet.metadata.filter_select,
      sheet.metadata.dataVerification,
      sheet.metadata.luckysheet_conditionformat_save,
      sheet.metadata.images,
    ].some(
      (value) =>
        value && typeof value === "object" && Object.keys(value).length,
    );
    if (hasData) return bad("含筛选、验证、条件格式或图片的行列移动暂不支持");
  }
}

function cellCommand(
  sheet: InternalSheet,
  row: number,
  column: number,
  value: SheetJson,
  state: BookState,
  format = false,
  attribute?: string,
  remove = false,
): CellCommand {
  const rows = active(sheet.rows),
    columns = active(sheet.columns);
  integer(row, 0, rows.length - 1);
  integer(column, 0, columns.length - 1);
  const attributes = attribute
    ? remove
      ? {}
      : { [attribute]: value }
    : value === null
      ? {}
      : typeof value === "object" && !Array.isArray(value)
        ? structuredClone(value)
        : { v: value };
  const current =
    sheet.cells[keyOf(rows[row].id, columns[column].id)]?.attributes ?? {};
  const removed = attribute
    ? remove
      ? [attribute]
      : []
    : format
      ? []
      : Object.keys(current).filter((key) => !(key in attributes));
  const formula =
    typeof attributes.f === "string"
      ? parseFormula(attributes.f, sheet, state)
      : undefined;
  if (formula) {
    delete attributes.v;
    delete attributes.m;
  }
  const removeFormula = attribute
    ? attribute === "f" && !formula
    : !format && !formula;
  return {
    type: "cell",
    sheet: String(sheet.metadata.id),
    row: rows[row].id,
    column: columns[column].id,
    attributes,
    remove: removed,
    formula,
    removeFormula,
  };
}

function normalizeNormalized(raw: unknown, state: BookState): Command[] {
  const op = object(raw),
    type = op.type;
  if (type === "addSheet") return addSheet(op.sheet, state);
  if (typeof op.sheetId !== "string") return bad("工作表 ID 无效");
  const sheet = findSheet(state, op.sheetId);
  if (type === "setCellContent") {
    const formula = op.formula;
    if (
      formula !== undefined &&
      (typeof formula !== "string" || !formula.startsWith("="))
    )
      return bad("公式须以 = 开头");
    const value = json(op.value);
    if (
      value !== null &&
      !["string", "number", "boolean"].includes(typeof value)
    )
      return bad("单元格值须为文字、数字、布尔或空值");
    const command = cellCommand(
      sheet,
      Number(op.row),
      Number(op.column),
      formula ? { f: formula } : value === null ? {} : { v: value },
      state,
      true,
    );
    command.remove = formula
      ? ["v", "m"]
      : value === null
        ? ["v", "m", "f"]
        : ["m", "f"];
    command.removeFormula = !formula;
    return [command];
  }
  if (type === "setCell" || type === "setCellFormat")
    return [
      cellCommand(
        sheet,
        Number(op.row),
        Number(op.column),
        json(type === "setCell" ? op.value : op.format),
        state,
        type === "setCellFormat",
      ),
    ];
  if (type === "deleteSheet")
    return [{ type: "deleteSheet", sheet: op.sheetId }];
  if (type === "renameSheet") {
    if (typeof op.name !== "string" || !op.name || op.name.length > 100)
      return bad("工作表名称无效");
    return [
      {
        type: "property",
        sheet: op.sheetId,
        path: ["name"],
        value: op.name,
        remove: false,
      },
    ];
  }
  const name: AxisName =
    typeof type === "string" && type.endsWith("Rows") ? "row" : "column";
  const items = active(axis(sheet, name));
  if (type === "insertRows" || type === "insertColumns") {
    const index = integer(op.index, 0, items.length),
      count = integer(op.count, 1, 1000);
    return [
      {
        type: "insert",
        sheet: op.sheetId,
        axis: name,
        anchor: items[index]?.id,
        items: Array.from({ length: count }, () => randomUUID()),
      },
    ];
  }
  if (
    type === "deleteRows" ||
    type === "deleteColumns" ||
    type === "moveRows" ||
    type === "moveColumns"
  ) {
    const start = integer(op.start, 0, items.length - 1),
      end = integer(op.end, start, items.length - 1);
    const targets = items.slice(start, end + 1).map((item) => item.id);
    if (type.startsWith("delete"))
      return [{ type: "delete", sheet: op.sheetId, axis: name, targets }];
    const before = integer(op.before, 0, items.length);
    return [
      {
        type: "move",
        sheet: op.sheetId,
        axis: name,
        targets,
        anchor: items[before]?.id,
      },
    ];
  }
  return bad("不支持的表格命令");
}

function normalizeFortune(
  raw: unknown,
  state: BookState,
  structuralBatch: boolean,
): Command[] {
  const op = object(raw),
    operation = op.op;
  if (
    typeof op.id !== "string" ||
    !op.id ||
    op.id.length > 100 ||
    !Array.isArray(op.path) ||
    op.path.length > 12 ||
    op.path.some(
      (part) =>
        (typeof part !== "string" && typeof part !== "number") ||
        (typeof part === "number" &&
          (!Number.isInteger(part) || part < 0 || part > 10_000)) ||
        (typeof part === "string" && (!part || part.length > 100)) ||
        forbidden.has(String(part)),
    )
  )
    return bad("非法表格操作路径");
  if (operation === "addSheet") return addSheet(op.value, state);
  const sheet = findSheet(state, op.id),
    path = op.path as (string | number)[];
  if (operation === "deleteSheet")
    return [{ type: "deleteSheet", sheet: op.id }];
  if (operation === "insertRowCol" || operation === "deleteRowCol") {
    const value = object(op.value);
    if (value.type !== "row" && value.type !== "column")
      return bad("行列类型无效");
    if (operation === "insertRowCol") {
      if (value.direction !== "lefttop" && value.direction !== "rightbottom")
        return bad("插入方向无效");
      return normalizeNormalized(
        {
          type: value.type === "row" ? "insertRows" : "insertColumns",
          sheetId: op.id,
          index:
            Number(value.index) + (value.direction === "rightbottom" ? 1 : 0),
          count: value.count,
        },
        state,
      );
    }
    return normalizeNormalized(
      {
        type: value.type === "row" ? "deleteRows" : "deleteColumns",
        sheetId: op.id,
        start: value.start,
        end: value.end,
      },
      state,
    );
  }
  if (operation !== "add" && operation !== "replace" && operation !== "remove")
    return bad("不支持的 Fortune 操作");
  if (!path.length || path[0] === "id") return bad("禁止修改工作表身份");
  if (derivedProperties.has(String(path[0]))) return [];
  // Fortune 结构操作会同时输出旧修订的派生配置与公式，不能覆盖权威重建结果。
  if (
    structuralBatch &&
    (path[0] === "data" ||
      path[0] === "row" ||
      path[0] === "column" ||
      path[0] === "config" ||
      path[0] === "filter" ||
      path[0] === "filter_select" ||
      path[0] === "dataVerification" ||
      path[0] === "hyperlink" ||
      String(path[0]).startsWith("luckysheet_"))
  )
    return [];
  if (path[0] === "data") {
    if (
      path.length === 2 &&
      operation !== "remove" &&
      Array.isArray(op.value)
    ) {
      const row = integer(path[1], 0, active(sheet.rows).length - 1);
      if (op.value.length > active(sheet.columns).length)
        return bad("粘贴列范围超限");
      return op.value.map((value, column) =>
        cellCommand(sheet, row, column, json(value), state),
      );
    }
    if (path.length !== 3 && path.length !== 4)
      return bad("协作不接受整表快照覆盖或不支持的单元格嵌套路径");
    const r = integer(path[1], 0, active(sheet.rows).length - 1),
      c = integer(path[2], 0, active(sheet.columns).length - 1);
    if (path.length === 4 && typeof path[3] !== "string")
      return bad("单元格字段无效");
    return [
      cellCommand(
        sheet,
        r,
        c,
        operation === "remove" ? null : json(op.value),
        state,
        false,
        path.length === 4 ? String(path[3]) : undefined,
        operation === "remove",
      ),
    ];
  }
  if (path[0] === "row" || path[0] === "column")
    return bad("行列数量必须通过结构命令修改");
  if (
    path[0] === "name" &&
    (operation === "remove" ||
      typeof op.value !== "string" ||
      !op.value ||
      op.value.length > 100)
  )
    return bad("工作表名称无效");
  const command: PropertyCommand = {
    type: "property",
    sheet: op.id,
    path,
    remove: operation === "remove",
    value: operation === "remove" ? undefined : json(op.value),
  };
  command.coordinateAxes = {
    rows: active(sheet.rows).map((entry) => entry.id),
    columns: active(sheet.columns).map((entry) => entry.id),
  };
  if (path[0] === "config" && path.length === 3) {
    const name = String(path[1]);
    const axisName = [
      "rowlen",
      "rowhidden",
      "rowReadOnly",
      "customHeight",
    ].includes(name)
      ? "row"
      : ["columnlen", "colhidden", "colReadOnly"].includes(name)
        ? "column"
        : undefined;
    if (axisName) {
      const items = active(axis(sheet, axisName));
      const index = integer(Number(path[2]), 0, items.length - 1);
      command.axisKey = { axis: axisName, id: items[index].id };
    }
  }
  return [command];
}

/** 单实例房间的权威操作状态。调用方在数据库提交成功后才能发布新实例和确认。 */
export class SheetEngine {
  private stored: Stored;
  private state: BookState;
  private workbook: ObjectValue[];
  private historicalStates = new Map<RevisionView, BookState>();
  private limits: {
    revisionWindow: number;
    undoWindow: number;
    historyWindow: number;
    contentMaxBytes: number;
  };

  constructor(
    workbook: unknown,
    options: {
      epoch?: number;
      revision?: number;
      revisionWindow?: number;
      undoWindow?: number;
      historyWindow?: number;
      contentMaxBytes?: number;
    } = {},
  ) {
    const config = sheetCollaborationConfig();
    this.limits = {
      contentMaxBytes: integer(
        options.contentMaxBytes ?? config.SHEET_COLLAB_MAX_CONTENT_BYTES,
        1024,
        8 * 1024 * 1024,
      ),
      revisionWindow: integer(
        options.revisionWindow ?? config.SHEET_COLLAB_REVISION_WINDOW,
        1,
        4096,
      ),
      undoWindow: integer(
        options.undoWindow ?? config.SHEET_COLLAB_UNDO_WINDOW,
        1,
        4096,
      ),
      historyWindow: integer(
        options.historyWindow ?? config.SHEET_COLLAB_HISTORY_WINDOW,
        1,
        65536,
      ),
    };
    const baseline = initBook(workbook);
    const epoch = integer(options.epoch ?? 1, 1, Number.MAX_SAFE_INTEGER),
      revision = integer(options.revision ?? 0, 0, Number.MAX_SAFE_INTEGER);
    this.stored = {
      schema: 1,
      epoch,
      revision,
      baseline,
      events: [],
      views: [revisionView(revision, [])],
      accepted: [],
    };
    this.state = baseline;
    this.workbook = project(baseline);
    this.checkSize(this.workbook);
  }

  static restore(serialized: unknown): SheetEngine {
    const data = object(json(serialized));
    if (
      data.schema !== 1 ||
      !Array.isArray(data.events) ||
      !Array.isArray(data.views) ||
      !Array.isArray(data.accepted)
    )
      return bad("表格引擎存储版本无效");
    const stored = data as unknown as Stored;
    integer(stored.epoch, 1, Number.MAX_SAFE_INTEGER);
    integer(stored.revision, 0, Number.MAX_SAFE_INTEGER);
    for (const event of stored.events) {
      event.revision ??=
        stored.accepted.find(
          (entry) => entry.key === JSON.stringify([event.session, event.id]),
        )?.revision ?? 0;
    }
    const state = replay(stored.baseline, stored.events);
    const instance = Object.create(SheetEngine.prototype) as SheetEngine;
    const config = sheetCollaborationConfig();
    instance.limits = {
      contentMaxBytes: config.SHEET_COLLAB_MAX_CONTENT_BYTES,
      revisionWindow: config.SHEET_COLLAB_REVISION_WINDOW,
      undoWindow: config.SHEET_COLLAB_UNDO_WINDOW,
      historyWindow: config.SHEET_COLLAB_HISTORY_WINDOW,
    };
    instance.historicalStates = new Map();
    instance.stored = stored;
    instance.state = state;
    instance.workbook = project(state);
    instance.checkSize(instance.workbook);
    return instance;
  }

  /** 房间事务候选共享不可变历史，只有成功 commit 才交换新的状态引用。 */
  fork(): SheetEngine {
    const instance = Object.create(SheetEngine.prototype) as SheetEngine;
    instance.historicalStates = this.historicalStates;
    instance.limits = this.limits;
    instance.stored = this.stored;
    instance.state = this.state;
    instance.workbook = this.workbook;
    return instance;
  }

  snapshot(): SheetEngineSnapshot {
    return {
      epoch: this.stored.epoch,
      revision: this.stored.revision,
      workbook: structuredClone(this.workbook),
    };
  }
  serialize(): SheetJson {
    // 明确消除内部可选字段，数据库 JSON 序列化得到同一规范表示。
    return JSON.parse(JSON.stringify(this.stored)) as SheetJson;
  }
  get revision() {
    return this.stored.revision;
  }
  get minimumRevision() {
    return this.stored.views[0]?.revision ?? this.revision;
  }
  get epoch() {
    return this.stored.epoch;
  }

  dispatch(
    sessionId: string,
    baseRevision: number,
    opId: string,
    operations: readonly (SheetCommand | FortuneOperation)[],
    options: { epoch?: number; expectedRevision?: number } = {},
  ): SheetEngineSnapshot {
    this.checkEpoch(options.epoch);
    this.validateIdentity(sessionId, opId);
    if (
      !Array.isArray(operations) ||
      !operations.length ||
      operations.length > 2000
    )
      return bad("操作数量必须为 1–2000");
    integer(baseRevision, 0, Number.MAX_SAFE_INTEGER);
    const request = JSON.stringify(
      json({
        baseRevision,
        operations,
        expectedRevision: options.expectedRevision ?? null,
      }),
    );
    if (
      Buffer.byteLength(request) >
      sheetCollaborationConfig().SHEET_COLLAB_MAX_MESSAGE_BYTES
    )
      throw new SheetEngineError(
        "MESSAGE_TOO_LARGE",
        "表格操作消息超过配置的 UTF-8 字节上限",
      );
    const fingerprint = createHash("sha256").update(request).digest("hex");
    const operationKey = JSON.stringify([sessionId, opId]);
    const previous = this.stored.accepted.find(
      (entry) => entry.key === operationKey,
    );
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new SheetEngineError(
          "OPERATION_ID_CONFLICT",
          "操作标识已用于不同请求",
        );
      return this.snapshot();
    }
    if (
      options.expectedRevision !== undefined &&
      options.expectedRevision !== this.revision
    )
      return conflict();
    const view = this.stored.views.find(
      (entry) => entry.revision === baseRevision,
    );
    if (!view) return conflict();
    let working: BookState;
    if (baseRevision === this.revision) working = structuredClone(this.state);
    else {
      let historical = this.historicalStates.get(view);
      if (!historical) {
        if ("state" in view) historical = view.state;
        else {
          const inactive = new Set(view.inactive);
          historical = replay(
            this.stored.baseline,
            this.stored.events
              .slice(0, view.eventCount)
              .map((event, index) => ({
                ...event,
                active: !inactive.has(index),
              })),
          );
        }
        this.historicalStates.set(view, historical);
        // 同一轮并发来源共用旧修订；派生缓存固定两份，不复制整个修订窗口。
        if (this.historicalStates.size > 2) {
          const oldest = this.historicalStates.keys().next().value;
          if (oldest) this.historicalStates.delete(oldest);
        }
      }
      working = structuredClone(historical);
    }
    const normalized: Command[] = [];
    const structuralBatch = operations.some(
      (entry) =>
        "op" in entry &&
        (entry.op === "insertRowCol" || entry.op === "deleteRowCol"),
    );
    for (const operation of operations) {
      const commands =
        "op" in operation
          ? normalizeFortune(operation, working, structuralBatch)
          : normalizeNormalized(operation, working);
      normalized.push(...commands);
      // 归一命令按批内前一条结果定位，支持原子 AI 先插行再填值。
      if (!("op" in operation))
        working = replay(working, [
          {
            id: opId,
            session: sessionId,
            commands,
            active: true,
            redoable: false,
          },
        ]);
    }
    const events = this.stored.events.map((event) => ({ ...event }));
    for (const event of events)
      if (event.session === sessionId && !event.active) event.redoable = false;
    const event: Event = {
      id: opId,
      session: sessionId,
      commands: normalized,
      revision: this.revision + 1,
      active: true,
      redoable: false,
    };
    events.push(event);
    return this.commit(events, { key: operationKey, fingerprint }, event);
  }

  undo(
    sessionId: string,
    options: { epoch?: number; expectedRevision?: number } = {},
  ): SheetEngineSnapshot {
    this.checkEpoch(options.epoch);
    this.validateIdentity(sessionId, "undo");
    if (
      options.expectedRevision !== undefined &&
      options.expectedRevision !== this.revision
    )
      return conflict();
    const events = this.stored.events.map((event) => ({ ...event }));
    const eligible = this.undoable(events, this.revision);
    const target = [...events]
      .reverse()
      .find(
        (entry) =>
          entry.session === sessionId && entry.active && eligible.has(entry),
      );
    if (!target) {
      if (
        this.stored.expiredUndoSources?.includes(sessionId) ||
        events.some((event) => event.session === sessionId && event.active)
      )
        throw new SheetEngineError(
          "UNDO_WINDOW_EXPIRED",
          "没有可撤销的操作；超过个人撤销窗口的修改已固定到检查点",
        );
      return this.snapshot();
    }
    target.active = false;
    target.redoable = true;
    target.undoneAt = this.revision + 1;
    return this.commit(events);
  }

  redo(
    sessionId: string,
    options: { epoch?: number; expectedRevision?: number } = {},
  ): SheetEngineSnapshot {
    this.checkEpoch(options.epoch);
    this.validateIdentity(sessionId, "redo");
    if (
      options.expectedRevision !== undefined &&
      options.expectedRevision !== this.revision
    )
      return conflict();
    const events = this.stored.events.map((event) => ({ ...event }));
    const eligible = this.undoable(events, this.revision);
    const target = events
      .filter(
        (entry) =>
          entry.session === sessionId &&
          !entry.active &&
          entry.redoable &&
          eligible.has(entry),
      )
      .sort((a, b) => (b.undoneAt ?? 0) - (a.undoneAt ?? 0))[0];
    if (!target) {
      if (
        this.stored.expiredRedoSources?.includes(sessionId) ||
        events.some(
          (event) =>
            event.session === sessionId && !event.active && event.redoable,
        )
      )
        throw new SheetEngineError(
          "UNDO_WINDOW_EXPIRED",
          "操作已超过个人撤销窗口，无法重做",
        );
      return this.snapshot();
    }
    target.active = true;
    target.redoable = false;
    return this.commit(events);
  }

  replaceWorkbook(
    workbook: unknown,
    expectedRevision: number,
  ): SheetEngineSnapshot {
    if (expectedRevision !== this.revision) return conflict();
    const baseline = initBook(workbook),
      projected = project(baseline),
      revision = this.revision + 1;
    this.checkSize(projected);
    this.stored = {
      schema: 1,
      epoch: this.epoch + 1,
      revision,
      baseline,
      events: [],
      views: [revisionView(revision, [])],
      accepted: [],
    };
    this.state = baseline;
    this.workbook = projected;
    return this.snapshot();
  }

  private commit(
    events: Event[],
    accepted?: { key: string; fingerprint: string },
    incremental?: Event,
  ): SheetEngineSnapshot {
    // 普通单元格只追加 LWW 写入。墓碑复活依赖其他来源历史，必须完整重放。
    const appendOnlyCells = incremental?.commands.every((command) => {
      if (command.type !== "cell") return false;
      const sheet = this.state.sheets.find(
        (entry) => entry.metadata.id === command.sheet && !entry.deleted,
      );
      return (
        !!sheet &&
        sheet.rows.some((row) => row.id === command.row && !row.deleted) &&
        sheet.columns.some(
          (column) => column.id === command.column && !column.deleted,
        )
      );
    });
    const candidate =
        appendOnlyCells && incremental
          ? replay(this.state, [incremental])
          : replay(this.stored.baseline, events),
      workbook = project(candidate),
      revision = this.revision + 1;
    this.checkSize(workbook);
    const result: SheetEngineSnapshot = {
      epoch: this.epoch,
      revision,
      workbook: structuredClone(workbook),
    };
    // 校验、结构变换和公式求值全部成功才交换状态；调用方仍负责事务落盘。
    const stored: Stored = {
      ...this.stored,
      events,
      revision,
      views: [...this.stored.views, revisionView(revision, events)].filter(
        (view) => view.revision >= revision - this.limits.revisionWindow,
      ),
      accepted: accepted
        ? [...this.stored.accepted, { ...accepted, revision }]
        : this.stored.accepted,
    };
    this.compact(stored);
    this.stored = stored;
    this.state = candidate;
    this.workbook = workbook;
    return result;
  }
  private undoable(events: Event[], revision: number): Set<Event> {
    const counts = new Map<string, number>();
    const eligible = new Set<Event>();
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index]!;
      const count = (counts.get(event.session) ?? 0) + 1;
      counts.set(event.session, count);
      if (
        count <= this.limits.undoWindow &&
        (event.revision ?? 0) >= revision - this.limits.historyWindow
      )
        eligible.add(event);
    }
    return eligible;
  }

  /** 只冻结不再可撤销且不被旧坐标窗口需要的连续前缀，epoch 和稳定轴身份不变。 */
  private compact(stored: Stored) {
    const eligible = this.undoable(stored.events, stored.revision);
    let frontier = stored.events.findIndex((event) => eligible.has(event));
    if (frontier === -1) frontier = stored.events.length;
    for (const view of stored.views) {
      if (!("eventCount" in view)) continue;
      frontier = Math.min(frontier, view.eventCount);
      const inactive = new Set(view.inactive);
      for (let index = 0; index < frontier; index++)
        if (stored.events[index]!.active === inactive.has(index)) {
          frontier = index;
          break;
        }
    }
    if (frontier > 0) {
      const prefix = stored.events.slice(0, frontier);
      const baseline = replay(stored.baseline, prefix, stored.events);
      const remaining = stored.events.slice(frontier);
      // 冻结包含其他来源仍在引用的旧结构；窗口内事件继续按原稳定 ID 重放。
      stored.baseline = baseline;
      stored.events = remaining;
      stored.views = stored.views.map((view) =>
        "eventCount" in view
          ? {
              ...view,
              eventCount: view.eventCount - frontier,
              inactive: view.inactive
                .filter((index) => index >= frontier)
                .map((index) => index - frontier),
            }
          : view,
      );
      stored.expiredUndoSources = [
        ...new Set([
          ...(stored.expiredUndoSources ?? []),
          ...prefix
            .filter((event) => event.active)
            .map((event) => event.session),
        ]),
      ];
      stored.expiredRedoSources = [
        ...new Set([
          ...(stored.expiredRedoSources ?? []),
          ...prefix
            .filter((event) => !event.active && event.redoable)
            .map((event) => event.session),
        ]),
      ];
    }
    const earliest = stored.views[0]?.revision ?? stored.revision;
    stored.accepted = stored.accepted.filter(
      (entry) => entry.revision > earliest,
    );
  }

  private checkSize(workbook: ObjectValue[]) {
    if (
      Buffer.byteLength(JSON.stringify(workbook)) > this.limits.contentMaxBytes
    )
      throw new SheetEngineError(
        "CONTENT_TOO_LARGE",
        "表格内容超过配置的 UTF-8 字节上限",
      );
  }
  private checkEpoch(epoch?: number) {
    if (epoch !== undefined && epoch !== this.epoch)
      throw new SheetEngineError(
        "EPOCH_CONFLICT",
        "表格版本已恢复或替换，请重新载入",
      );
  }
  private validateIdentity(session: string, operation: string) {
    if (
      typeof session !== "string" ||
      typeof operation !== "string" ||
      !session ||
      session.length > 200 ||
      !operation ||
      operation.length > 200
    )
      return bad("会话或操作标识无效");
  }
}
