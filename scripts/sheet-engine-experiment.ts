import {
  defaultContext,
  execfunction,
  insertRowCol,
  deleteRowCol,
} from "../apps/web/node_modules/@fortune-sheet/core/dist/index.js";
import type { Sheet } from "../apps/web/node_modules/@fortune-sheet/core/dist/index.js";

/** 只验证 Fortune 的无 DOM 计算能力，不能作为生产协作协议。 */
export function createHeadlessContext(sheets: Sheet[]) {
  const context = defaultContext({
    globalCache: { undoList: [], redoList: [] },
    cellInput: { current: null },
    fxInput: { current: null },
    canvas: { current: null },
    cellArea: { current: null },
    workbookContainer: { current: null },
  });
  context.luckysheetfile = structuredClone(sheets);
  if (!sheets[0]?.id) throw new Error("工作表 ID 必须存在");
  context.currentSheetId = sheets[0].id;
  return context;
}

export { execfunction, insertRowCol, deleteRowCol };

/** 同格覆盖后，撤销本人写入必须保留后来其他会话写入。 */
export class SelectiveCellHistory {
  private events: { session: string; value: string; undone: boolean }[] = [];

  write(session: string, value: string) {
    this.events.push({ session, value, undone: false });
  }

  undo(session: string) {
    const own = [...this.events]
      .reverse()
      .find((event) => event.session === session && !event.undone);
    if (own) own.undone = true;
    return this.value;
  }

  get value() {
    return (
      [...this.events].reverse().find((event) => !event.undone)?.value ?? ""
    );
  }
}

/** 用稳定行 ID 解释旧修订输入；删除明确目标集合，不删除并发新增行。 */
export class StableRows {
  constructor(public ids: string[]) {}

  insertBefore(anchorId: string | undefined, ids: string[]) {
    const index =
      anchorId === undefined ? this.ids.length : this.ids.indexOf(anchorId);
    if (index < 0) throw new Error("定位行已被删除，需依据保留的墓碑定位");
    this.ids.splice(index, 0, ...ids);
  }

  remove(targets: string[]) {
    const removed = new Set(targets);
    this.ids = this.ids.filter((id) => !removed.has(id));
  }

  resolve(rowId: string) {
    return this.ids.indexOf(rowId);
  }
}
