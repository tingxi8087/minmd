import { request } from "@/http";
export interface DatabaseTable {
  schema: string;
  name: string;
  comment: string;
}
export interface DatabaseColumn {
  name: string;
  type: string;
  nullable: boolean;
  comment: string;
  primary: boolean;
}
export interface TableData {
  columns: DatabaseColumn[];
  rows: unknown[][];
  total: number;
  page: number;
  pageSize: number;
}
export interface SqlResult {
  columns: { name: string; typeId: number }[];
  rows: unknown[][];
  affectedRows: number;
  command: string;
  duration: number;
  executionId: string;
  auditWarning?: string;
}
export const loadDatabase = () =>
  Promise.all([
    request.get<never, { tables: DatabaseTable[] }>("/api/database/tables"),
    request.get<
      never,
      {
        environment: string;
        database: string;
        limits: { rows: number; bytes: number; timeoutMs: number };
      }
    >("/api/database/config"),
  ]);
export const loadTable = (
  table: DatabaseTable,
  page: number,
  pageSize: number,
) =>
  request.get<never, TableData>("/api/database/table", {
    params: { schema: table.schema, table: table.name, page, pageSize },
    timeout: 25000,
  });
export const executeSql = (sql: string, confirmEnvironment?: string) =>
  request.post<never, SqlResult>(
    "/api/database/execute",
    { sql, confirmEnvironment },
    { timeout: 30000 },
  );
