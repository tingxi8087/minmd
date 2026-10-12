import { z } from "zod";
import { AppError } from "../../../../../system/server/src/errors";
import type { SheetCommand } from "../collaboration/sheet-engine";

const index = z
  .number()
  .int()
  .min(0)
  .max(9999)
  .describe("0基行列索引，范围终点包含在内");
const sheetId = z
  .string()
  .min(1)
  .max(100)
  .describe("读取结果中的稳定工作表 ID");
const range = {
  sheetId,
  startRow: index,
  endRow: index,
  startColumn: index.max(999),
  endColumn: index.max(999),
};
const format = z
  .record(z.string(), z.unknown())
  .describe("Fortune 单元格格式，fc/bg/fs/bl/it/ct 等；不能包含值或公式");
const cell = z
  .object({
    value: z
      .union([
        z.string().max(10000),
        z.number().finite(),
        z.boolean(),
        z.null(),
      ])
      .describe("文字、数字、布尔或空值；不能与formula同时指定")
      .optional(),
    formula: z
      .string()
      .min(2)
      .max(10000)
      .regex(/^=/)
      .describe("以=开头的公式，由服务端计算；不能同时指定value")
      .optional(),
    format: format.optional(),
  })
  .strict()
  .refine(
    (value) => !(value.value !== undefined && value.formula !== undefined),
    "value 与 formula 不能同时指定",
  )
  .refine(
    (value) =>
      value.value !== undefined ||
      value.formula !== undefined ||
      value.format !== undefined,
    "单元格须指定值、公式或格式",
  );
export const workbookReadSchema = z
  .object({
    sheetId: sheetId.optional(),
    startRow: index.optional(),
    endRow: index.optional(),
    startColumn: index.max(999).optional(),
    endColumn: index.max(999).optional(),
    includeFormat: z
      .boolean()
      .describe("是否返回单元格格式，默认不返回")
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.sheetId !== undefined ||
      [value.startRow, value.endRow, value.startColumn, value.endColumn].every(
        (item) => item === undefined,
      ),
    "范围读取须指定 sheetId",
  );
export const workbookOperations = z
  .array(
    z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("set_cells").describe("按二维范围局部写入单元格"),
          sheetId,
          startRow: index,
          startColumn: index.max(999),
          cells: z
            .array(z.array(cell).min(1).max(100))
            .min(1)
            .max(100)
            .describe("从起点开始逐行写入的二维单元格；未指定格式保留"),
        })
        .strict(),
      z
        .object({
          type: z.literal("clear_range").describe("清空范围值和公式，保留格式"),
          ...range,
        })
        .strict(),
      z
        .object({
          type: z
            .literal("format_range")
            .describe("更新指定范围格式，保留内容"),
          ...range,
          format,
        })
        .strict(),
      z
        .object({
          type: z.literal("insert_rows").describe("插入行并重定位引用"),
          sheetId,
          index,
          count: z.number().int().min(1).max(1000).describe("插入行数"),
        })
        .strict(),
      z
        .object({
          type: z.literal("insert_columns").describe("插入列并重定位引用"),
          sheetId,
          index,
          count: z.number().int().min(1).max(1000).describe("插入列数"),
        })
        .strict(),
      z
        .object({
          type: z.literal("delete_rows").describe("删除闭区间内行并重定位引用"),
          sheetId,
          start: index,
          end: index,
        })
        .strict(),
      z
        .object({
          type: z
            .literal("delete_columns")
            .describe("删除闭区间内列并重定位引用"),
          sheetId,
          start: index,
          end: index,
        })
        .strict(),
      z
        .object({
          type: z.literal("add_sheet").describe("新建空白工作表"),
          sheetId,
          name: z.string().min(1).max(100).describe("工作表名称"),
          rows: z
            .number()
            .int()
            .min(1)
            .max(10000)
            .describe("初始行数，默认100")
            .optional(),
          columns: z
            .number()
            .int()
            .min(1)
            .max(1000)
            .describe("初始列数，默认26")
            .optional(),
        })
        .strict(),
      z
        .object({
          type: z
            .literal("rename_sheet")
            .describe("重命名工作表并重写跨表引用"),
          sheetId,
          name: z.string().min(1).max(100).describe("新的工作表名称"),
        })
        .strict(),
      z
        .object({
          type: z.literal("delete_sheet").describe("删除工作表，至少保留一张"),
          sheetId,
        })
        .strict(),
    ]),
  )
  .min(1)
  .max(100)
  .describe("原子命令批次，展开后最多2000条单元格或结构命令");
export const workbookUpdateSchema = z
  .object({
    expectedRevision: z
      .number()
      .int()
      .min(1)
      .describe("最近读取的持久化修订号，变化时拒绝写入"),
    expectedEpoch: z
      .number()
      .int()
      .min(1)
      .describe("最近读取的工作簿epoch，整体导入或恢复后变化"),
    requestId: z
      .string()
      .min(8)
      .max(100)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .describe("当前密钥唯一幂等请求ID，相同ID不同请求返回409"),
    operations: workbookOperations,
  })
  .strict();
export type WorkbookRead = z.infer<typeof workbookReadSchema>;
export type WorkbookUpdate = z.infer<typeof workbookUpdateSchema>;
/** Ajv 的 anyOf 分支会强制转换值；多类型关键字保持 HTTP/MCP 单元格类型和幂等摘要一致。 */
export function workbookHttpSchema(schema: z.ZodType): Record<string, unknown> {
  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(walk);
    if (!input || typeof input !== "object") return input;
    const result: Record<string, unknown> = Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, walk(value)]),
    );
    if (
      Array.isArray(result.anyOf) &&
      result.anyOf.every(
        (item: unknown) =>
          item &&
          typeof item === "object" &&
          "type" in item &&
          ["string", "number", "boolean", "null"].includes(String(item.type)),
      )
    ) {
      const children = result.anyOf as Record<string, unknown>[];
      result.type = children.map((child) => child.type);
      for (const child of children)
        for (const [key, value] of Object.entries(child))
          if (key !== "type") result[key] = value;
      delete result.anyOf;
    }
    return result;
  };
  return walk(
    z.toJSONSchema(schema, { io: "input", target: "draft-7" }),
  ) as Record<string, unknown>;
}

export function workbookCommands(input: WorkbookUpdate): SheetCommand[] {
  const commands: SheetCommand[] = [];
  const checkedFormat = (value: Record<string, unknown>) => {
    if (
      [
        "v",
        "m",
        "f",
        "mc",
        "row",
        "column",
        "id",
        "__proto__",
        "constructor",
        "prototype",
      ].some((key) => Object.hasOwn(value, key))
    )
      throw new AppError(
        "FORMAT_INVALID",
        "格式不能包含值、公式、合并或定位字段",
        400,
      );
    return JSON.parse(JSON.stringify(value)) as Extract<
      SheetCommand,
      { type: "setCellFormat" }
    >["format"];
  };
  for (const operation of input.operations) {
    if (operation.type === "set_cells") {
      operation.cells.forEach((row, r) =>
        row.forEach((cell, c) => {
          const position = {
            sheetId: operation.sheetId,
            row: operation.startRow + r,
            column: operation.startColumn + c,
          };
          if (cell.value !== undefined || cell.formula !== undefined)
            commands.push({
              type: "setCellContent",
              ...position,
              value: cell.value ?? null,
              ...(cell.formula ? { formula: cell.formula } : {}),
            });
          if (cell.format)
            commands.push({
              type: "setCellFormat",
              ...position,
              format: checkedFormat(cell.format),
            });
        }),
      );
    } else if (
      operation.type === "clear_range" ||
      operation.type === "format_range"
    ) {
      if (
        operation.startRow > operation.endRow ||
        operation.startColumn > operation.endColumn ||
        (operation.endRow - operation.startRow + 1) *
          (operation.endColumn - operation.startColumn + 1) >
          2000
      )
        throw new AppError(
          "RANGE_INVALID",
          "范围无效或单次操作超过2000个单元格",
          400,
        );
      for (let row = operation.startRow; row <= operation.endRow; row++)
        for (
          let column = operation.startColumn;
          column <= operation.endColumn;
          column++
        )
          commands.push(
            operation.type === "clear_range"
              ? {
                  type: "setCellContent",
                  sheetId: operation.sheetId,
                  row,
                  column,
                  value: null,
                }
              : {
                  type: "setCellFormat",
                  sheetId: operation.sheetId,
                  row,
                  column,
                  format: checkedFormat(operation.format),
                },
          );
    } else if (operation.type === "add_sheet")
      commands.push({
        type: "addSheet",
        sheet: {
          id: operation.sheetId,
          name: operation.name,
          row: operation.rows ?? 100,
          column: operation.columns ?? 26,
          celldata: [],
        },
      });
    else if (operation.type === "rename_sheet")
      commands.push({
        type: "renameSheet",
        sheetId: operation.sheetId,
        name: operation.name,
      });
    else if (operation.type === "delete_sheet")
      commands.push({ type: "deleteSheet", sheetId: operation.sheetId });
    else if ("count" in operation)
      commands.push({
        type: operation.type === "insert_rows" ? "insertRows" : "insertColumns",
        sheetId: operation.sheetId,
        index: operation.index,
        count: operation.count,
      });
    else
      commands.push({
        type: operation.type === "delete_rows" ? "deleteRows" : "deleteColumns",
        sheetId: operation.sheetId,
        start: operation.start,
        end: operation.end,
      });
    if (commands.length > 2000)
      throw new AppError(
        "AI_BATCH_TOO_LARGE",
        "展开的原子命令不得超过2000条",
        413,
      );
  }
  return commands;
}
