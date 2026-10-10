import { Type } from "@sinclair/typebox";

const column = Type.Object({
  name: Type.String({ description: "字段名称", example: "id" }),
  type: Type.String({ description: "PostgreSQL 字段类型", example: "uuid" }),
  nullable: Type.Boolean({ description: "是否允许 NULL", example: false }),
  comment: Type.String({
    description: "字段注释；未设置时为空字符串",
    example: "记录编号",
  }),
  primary: Type.Boolean({ description: "是否属于主键", example: true }),
});
const rows = Type.Array(
  Type.Array(
    Type.Unknown({ description: "单元格值；类型由实际 SQL 查询决定" }),
    { description: "一行数据，按 columns 的顺序排列" },
  ),
  {
    description: "二维结果数组；保留重复列名对应的位置",
    example: [[1, "示例"]],
  },
);
export const databaseConfigSchema = Type.Object({
  environment: Type.String({
    description: "服务端环境",
    example: "development",
  }),
  database: Type.String({
    description: "当前连接的数据库名称",
    example: "mas_backend",
  }),
  limits: Type.Object(
    {
      rows: Type.Integer({ description: "单次返回行数上限", example: 500 }),
      bytes: Type.Integer({
        description: "返回行数据大小上限，单位字节",
        example: 1048576,
      }),
      timeoutMs: Type.Integer({
        description: "SQL 超时，单位毫秒",
        example: 5000,
      }),
    },
    { description: "服务端强制执行的资源限制" },
  ),
});
export const tableListSchema = Type.Object({
  tables: Type.Array(
    Type.Object({
      schema: Type.String({ description: "表所属 schema", example: "public" }),
      name: Type.String({ description: "表名称", example: "examples" }),
      comment: Type.String({
        description: "表注释；未设置时为空字符串",
        example: "业务示例",
      }),
    }),
    { description: "最多 500 张用户表，按 schema 和表名排序" },
  ),
});
export const tableDataSchema = Type.Object({
  columns: Type.Array(column, {
    description: "按数据库字段顺序排列的结构信息",
  }),
  rows,
  total: Type.Number({ description: "表记录总数", example: 1 }),
  page: Type.Integer({
    description: "实际返回页码；超出范围时校正到最后一页",
    example: 1,
  }),
  pageSize: Type.Integer({ description: "每页条数", example: 20 }),
});
export const sqlResultSchema = Type.Object({
  columns: Type.Array(
    Type.Object({
      name: Type.String({ description: "结果列名", example: "value" }),
      typeId: Type.Integer({
        description: "PostgreSQL 数据类型 OID",
        example: 23,
      }),
    }),
    { description: "SQL 返回的列信息；无返回数据的命令可为空" },
  ),
  rows,
  command: Type.String({
    description: "PostgreSQL 命令类型",
    example: "SELECT",
  }),
  affectedRows: Type.Number({
    description: "命令影响或返回的行数",
    example: 1,
  }),
  duration: Type.Number({ description: "执行耗时，单位毫秒", example: 8 }),
  executionId: Type.String({
    description: "本次执行编号，用于关联审计",
    example: "00000000-0000-4000-8000-000000000001",
  }),
  auditWarning: Type.Optional(
    Type.String({
      description: "SQL 已提交但结果审计未写入时返回；请勿重复执行",
    }),
  ),
});
