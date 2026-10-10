import dayjs from "dayjs";
import { request } from "@/http";
export interface RuntimeLog {
  id: string;
  requestId: string;
  time: string;
  level: string;
  path: string;
  method: string;
  status: number;
  duration: number;
  message: string;
  environment: string;
}
export interface AuditLog {
  id: string;
  time: string;
  actor: string;
  action: string;
  target: string;
  result: string;
  requestId: string;
  before: string;
  after: string;
  environment: string;
}
function timeRange(time?: [string, string]) {
  return time
    ? {
        from: time[0] ? dayjs(time[0]).startOf("day").toISOString() : undefined,
        to: time[1] ? dayjs(time[1]).endOf("day").toISOString() : undefined,
      }
    : {};
}
export async function getRuntimeLogs(query: {
  page: number;
  pageSize: number;
  id?: string;
  level?: string;
  path?: string;
  time?: [string, string];
}) {
  const { id, time, ...params } = query;
  const response = await request.get<
    never,
    {
      items: {
        id: string;
        requestId: string;
        createdAt: string;
        level: string;
        method: string;
        path: string;
        statusCode: number;
        durationMs: number;
        message: string;
        environment: string;
      }[];
      total: number;
      page: number;
      pageSize: number;
    }
  >("/api/admin/logs", {
    params: { ...params, requestId: id, ...timeRange(time) },
  });
  return {
    data: response.items.map((row) => ({
      ...row,
      time: dayjs(row.createdAt).format("YYYY-MM-DD HH:mm:ss"),
      status: row.statusCode,
      duration: row.durationMs,
    })),
    total: response.total,
    pageNum: response.page,
  };
}
export async function getAuditLogs(query: {
  page: number;
  pageSize: number;
  actor?: string;
  action?: string;
  result?: string;
  time?: [string, string];
}) {
  const { time, result, ...params } = query;
  const response = await request.get<
    never,
    {
      items: {
        id: string;
        createdAt: string;
        actorAccount: string | null;
        action: string;
        targetType: string;
        targetId: string | null;
        result: string;
        requestId: string;
        before: unknown;
        after: unknown;
        environment: string;
      }[];
      total: number;
      page: number;
      pageSize: number;
    }
  >("/api/admin/audit", {
    params: {
      ...params,
      result:
        result === "成功"
          ? "success"
          : result === "拒绝"
            ? "denied"
            : result === "失败"
              ? "failure"
              : undefined,
      ...timeRange(time),
    },
  });
  return {
    data: response.items.map((row) => ({
      ...row,
      time: dayjs(row.createdAt).format("YYYY-MM-DD HH:mm:ss"),
      actor: row.actorAccount ?? "未登录",
      target: `${row.targetType} ${row.targetId ?? ""}`,
      result:
        row.result === "success"
          ? "成功"
          : row.result === "failure"
            ? "失败"
            : "拒绝",
      before: JSON.stringify(row.before, null, 2),
      after: JSON.stringify(row.after, null, 2),
    })),
    total: response.total,
    pageNum: response.page,
  };
}
