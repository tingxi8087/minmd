import { useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Space,
  Table,
  Tag,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import SearchTableForm, { FormFieldConfig } from "@/components/SearchTableForm";
import { useBasePageTable } from "@/hooks/useTableHooks";
import { useElementBottomDistance } from "@/hooks/useElementBottomDistance";
import { RuntimeLog, getRuntimeLogs } from "@/http/services/logs";
import styles from "./index.module.less";
const fields: FormFieldConfig[] = [
  { name: "id", label: "请求 ID", type: "input" },
  {
    name: "level",
    label: "级别",
    type: "select",
    options: ["INFO", "WARN", "ERROR"].map((value) => ({
      value,
      label: value,
    })),
  },
  { name: "path", label: "请求路径", type: "input" },
  { name: "time", label: "时间范围", type: "dateRange", span: 12 },
];
type SearchParams = {
  id?: string;
  level?: string;
  path?: string;
  time?: [string, string];
};
export default function RuntimeLogs() {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const { distance } = useElementBottomDistance(toolbarRef);
  const [detail, setDetail] = useState<RuntimeLog>();
  const table = useBasePageTable<RuntimeLog, SearchParams>({
    defaultPageSize: 10,
    cachePageSizeKey: "runtime-log-page-size",
    getTableData: async ({ pageNum, pageSize, searchParams }) => {
      return getRuntimeLogs({ page: pageNum, pageSize, ...searchParams });
    },
  });
  return (
    <div className={styles.page}>
      <div className={styles.searchCard}>
        <Card size="small">
          <SearchTableForm
            name="runtime-log-search"
            fields={fields}
            value={table.searchParams}
            onFinish={table.setSearchParams}
            onReset={() => table.setSearchParams({})}
            enableFieldSetting
            fieldSettingCacheKey="runtime-log-search-fields"
          />
        </Card>
      </div>
      <Card size="small" className={styles.tableCard}>
        <div ref={toolbarRef} className={styles.optionsHeader}>
          <Space>
            <span>运行日志</span>
          </Space>
          <Button icon={<ReloadOutlined />} onClick={table.reloadTable}>
            刷新
          </Button>
        </div>
        {table.error ? (
          <Alert type="error" message="列表加载失败" />
        ) : (
          <Table<RuntimeLog>
            rowKey="id"
            size="small"
            dataSource={table.tableData}
            loading={table.loading}
            scroll={{ x: 1100, y: Math.max(80, Math.floor(distance - 140)) }}
            columns={[
              { title: "时间", dataIndex: "time", width: 175 },
              {
                title: "级别",
                dataIndex: "level",
                width: 90,
                render: (v: string) => (
                  <Tag
                    color={
                      v === "ERROR"
                        ? "error"
                        : v === "WARN"
                          ? "warning"
                          : "success"
                    }
                  >
                    {v}
                  </Tag>
                ),
              },
              { title: "请求 ID", dataIndex: "requestId", width: 130 },
              { title: "方法", dataIndex: "method", width: 90 },
              { title: "路径", dataIndex: "path", width: 190 },
              { title: "状态码", dataIndex: "status", width: 90 },
              {
                title: "耗时",
                dataIndex: "duration",
                width: 100,
                render: (v: number) => `${v} ms`,
              },
              { title: "消息", dataIndex: "message", width: 230 },
              {
                title: "操作",
                width: 80,
                fixed: "right",
                render: (_, row) => (
                  <Button
                    type="link"
                    size="small"
                    onClick={() => setDetail(row)}
                  >
                    详情
                  </Button>
                ),
              },
            ]}
            pagination={{
              current: table.pageNum,
              pageSize: table.pageSize,
              total: table.total,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`,
            }}
            onChange={(p) => {
              if (p.current) table.setPageNum(p.current);
              if (p.pageSize) table.setPageSize(p.pageSize);
            }}
          />
        )}
      </Card>
      <Drawer
        title="运行日志详情"
        width={560}
        open={!!detail}
        onClose={() => setDetail(undefined)}
      >
        {detail && (
          <>
            <Descriptions
              bordered
              column={1}
              size="small"
              items={[
                { key: "id", label: "请求 ID", children: detail.requestId },
                { key: "time", label: "时间", children: detail.time },
                { key: "level", label: "级别", children: detail.level },
                {
                  key: "path",
                  label: "请求",
                  children: `${detail.method} ${detail.path}`,
                },
                { key: "status", label: "状态码", children: detail.status },
                {
                  key: "duration",
                  label: "耗时",
                  children: `${detail.duration} ms`,
                },
                { key: "message", label: "消息", children: detail.message },
                { key: "env", label: "环境", children: detail.environment },
              ]}
            />
            <pre className={styles.json}>{JSON.stringify(detail, null, 2)}</pre>
          </>
        )}
      </Drawer>
    </div>
  );
}
