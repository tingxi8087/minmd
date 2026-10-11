import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type SheetData = { [key: string]: Json };
const pathPart = z.union([
  z.string().min(1).max(100),
  z.number().int().min(0).max(10000),
]);
export const operations = z
  .array(
    z
      .object({
        op: z.enum([
          "replace",
          "remove",
          "add",
          "insertRowCol",
          "deleteRowCol",
          "addSheet",
          "deleteSheet",
        ]),
        id: z.string().min(1).max(100),
        path: z.array(pathPart).max(12),
        value: z.unknown().optional(),
      })
      .strict(),
  )
  .min(1)
  .max(2000);
export type Operation = z.infer<typeof operations>[number];
const forbidden = new Set(["__proto__", "constructor", "prototype"]);
const object = (v: unknown): Record<string, Json> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("对象格式无效");
  return v as Record<string, Json>;
};
export function normalizeSheets(value: unknown): SheetData[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30)
    throw Error("工作表数量无效");
  const ids = new Set<string>();
  return value.map((raw) => {
    const sheet = structuredClone(object(raw));
    if (typeof sheet.id !== "string" || ids.has(sheet.id))
      throw Error("工作表 ID 无效");
    ids.add(sheet.id);
    if (typeof sheet.name !== "string") throw Error("工作表名称无效");
    const rows = typeof sheet.row === "number" ? sheet.row : 200,
      cols = typeof sheet.column === "number" ? sheet.column : 26;
    if (
      !Number.isInteger(rows) ||
      !Number.isInteger(cols) ||
      rows < 1 ||
      rows > 10000 ||
      cols < 1 ||
      cols > 1000 ||
      rows * cols > 300000
    )
      throw Error("工作表大小超限");
    if (!Array.isArray(sheet.data)) {
      const matrix: Json[][] = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => null),
      );
      for (const entry of Array.isArray(sheet.celldata) ? sheet.celldata : []) {
        const cell = object(entry);
        const r = Number(cell.r),
          c = Number(cell.c);
        if (
          !Number.isInteger(r) ||
          !Number.isInteger(c) ||
          r < 0 ||
          c < 0 ||
          r >= rows ||
          c >= cols
        )
          throw Error("单元格坐标无效");
        matrix[r][c] = cell.v ?? null;
      }
      sheet.data = matrix;
      delete sheet.celldata;
    }
    const matrix = sheet.data as Json[];
    if (
      matrix.length > 10000 ||
      matrix.some((row) => !Array.isArray(row) || row.length > 1000) ||
      matrix.reduce<number>(
        (count, row) => count + (Array.isArray(row) ? row.length : 0),
        0,
      ) > 300000
    )
      throw Error("单元格矩阵大小超限");
    return sheet;
  });
}
export function applyOperations(
  data: SheetData[],
  ops: Operation[],
): SheetData[] {
  const next = structuredClone(data);
  for (const op of ops) {
    if (op.path.some((p) => typeof p === "string" && forbidden.has(p)))
      throw Error("非法操作路径");
    if (op.op === "addSheet") {
      const sheet = normalizeSheets([op.value])[0];
      if (next.some((s) => s.id === sheet.id)) throw Error("工作表重复");
      next.push(sheet);
      continue;
    }
    const index = next.findIndex((s) => s.id === op.id);
    if (index < 0) throw Error("工作表不存在");
    const sheet = next[index];
    if (op.op === "deleteSheet") {
      if (next.length === 1) throw Error("至少保留一张工作表");
      next.splice(index, 1);
      continue;
    }
    if (op.op === "insertRowCol" || op.op === "deleteRowCol") {
      const v = object(op.value),
        matrix = sheet.data as Json[][];
      if (v.type !== "row" && v.type !== "column") throw Error("行列类型无效");
      const insertion = op.op === "insertRowCol",
        start =
          Number(insertion ? v.index : v.start) +
          (insertion && v.direction === "rightbottom" ? 1 : 0),
        count = insertion
          ? Number(v.count)
          : Number(v.end) - Number(v.start) + 1;
      const size = v.type === "row" ? matrix.length : matrix[0]?.length || 0;
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(count) ||
        start < 0 ||
        count < 1 ||
        count > 1000 ||
        start > size ||
        (!insertion && (start + count > size || count >= size))
      )
        throw Error("行列范围无效");
      if (v.type === "row")
        matrix.splice(
          start,
          insertion ? 0 : count,
          ...(insertion
            ? Array.from({ length: count }, () =>
                Array.from({ length: matrix[0].length }, () => null),
              )
            : []),
        );
      else
        for (const row of matrix)
          row.splice(
            start,
            insertion ? 0 : count,
            ...(insertion ? Array.from({ length: count }, () => null) : []),
          );
      continue;
    }
    if (!op.path.length || op.path[0] === "id" || op.path[0] === "celldata")
      throw Error("操作路径无效");
    let parent: Json = sheet;
    for (let i = 0; i < op.path.length - 1; i++) {
      const key = op.path[i];
      if (parent === null || typeof parent !== "object")
        throw Error("操作目标无效");
      const record = parent as Record<string, Json>;
      if (record[key] === undefined || record[key] === null)
        record[key] = typeof op.path[i + 1] === "number" ? [] : {};
      parent = record[key];
    }
    if (parent === null || typeof parent !== "object")
      throw Error("操作目标无效");
    const key = op.path[op.path.length - 1];
    if (Array.isArray(parent) && typeof key === "number") {
      if (key > parent.length) throw Error("数组范围无效");
      if (op.op === "remove") parent.splice(key, 1);
      else if (op.op === "add") parent.splice(key, 0, op.value as Json);
      else parent[key] = op.value as Json;
    } else {
      const record = parent as Record<string, Json>;
      if (op.op === "remove") delete record[key];
      else record[key] = op.value as Json;
    }
  }
  if (JSON.stringify(next).length > 8 * 1024 * 1024)
    throw Error("表格内容超限");
  return normalizeSheets(next);
}
export class SheetRoom {
  revision = 0;
  lastStructural = 0;
  data: SheetData[] = [];
  members = new Map<string, (message: unknown) => void>();
  private tail: Promise<unknown> = Promise.resolve();
  private accepted = new Map<string, unknown>();
  constructor(
    readonly id: string,
    readonly directory: string,
    readonly limit: number,
  ) {}
  async load() {
    try {
      const saved = JSON.parse(
        await readFile(join(this.directory, `${this.id}.json`), "utf8"),
      );
      this.data = normalizeSheets(saved.data);
      this.revision = saved.revision;
      this.lastStructural = saved.lastStructural;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  admit(id: string, send: (message: unknown) => void) {
    if (this.members.size >= this.limit) return false;
    this.members.set(id, send);
    return true;
  }
  snapshot() {
    return {
      type: "snapshot",
      data: this.data,
      revision: this.revision,
      count: this.members.size,
      limit: this.limit,
    };
  }
  broadcast(message: unknown) {
    for (const send of this.members.values()) send(message);
  }
  leave(id: string) {
    this.members.delete(id);
    this.broadcast({ type: "leave", sender: id });
    this.broadcast({
      type: "members",
      count: this.members.size,
      limit: this.limit,
    });
  }
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => {});
    return result;
  }
  async persist(data: SheetData[], revision: number, structural: number) {
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, `${this.id}.json`),
      temp = `${path}.tmp`;
    await writeFile(
      temp,
      JSON.stringify({ data, revision, lastStructural: structural }),
    );
    await rename(temp, path);
  }
  async initialize(data: unknown) {
    if (this.data.length) return;
    const next = normalizeSheets(data);
    await this.persist(next, 0, 0);
    this.data = next;
  }
  async submit(sender: string, sequence: number, base: number, input: unknown) {
    const key = `${sender}:${sequence}`;
    if (this.accepted.has(key)) {
      this.members.get(sender)?.(this.accepted.get(key));
      return;
    }
    const ops = operations.parse(input),
      structural = ops.some(
        (op) =>
          !["add", "replace", "remove"].includes(op.op) ||
          op.path[0] !== "data",
      );
    if (
      base > this.revision ||
      base < this.lastStructural ||
      (structural && base !== this.revision)
    ) {
      this.members.get(sender)?.({
        message: "目录或行列结构已变化，本次修改已保留为本地副本，请重新操作",
        ...this.snapshot(),
        typeConflict: true,
      });
      return;
    }
    const next = applyOperations(this.data, ops),
      revision = this.revision + 1,
      lastStructural = structural ? revision : this.lastStructural;
    await this.persist(next, revision, lastStructural);
    this.data = next;
    this.revision = revision;
    this.lastStructural = lastStructural;
    const packet = { type: "op", sender, sequence, ops, revision };
    this.accepted.set(key, packet);
    if (this.accepted.size > 256)
      this.accepted.delete(this.accepted.keys().next().value!);
    this.broadcast(packet);
  }
}
