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
import { AuditLog, getAuditLogs } from "@/http/services/logs";
import styles from "./index.module.less";
const fields: FormFieldConfig[] = [
  { name: "actor", label: "操作人", type: "input" },
  { name: "action", label: "操作", type: "input" },
  {
    name: "result",
    label: "结果",
    type: "select",
    options: ["成功", "拒绝", "失败"].map((value) => ({ value, label: value })),
  },
  { name: "time", label: "时间范围", type: "dateRange", span: 12 },
];
type SearchParams = {
  actor?: string;
  action?: string;
  result?: string;
  time?: [string, string];
};
export default function AuditLogs() {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const { distance } = useElementBottomDistance(toolbarRef);
  const [detail, setDetail] = useState<AuditLog>();
  const table = useBasePageTable<AuditLog, SearchParams>({
    defaultPageSize: 10,
    cachePageSizeKey: "audit-log-page-size",
    getTableData: async ({ pageNum, pageSize, searchParams }) => {
      return getAuditLogs({ page: pageNum, pageSize, ...searchParams });
    },
  });
  return (
    <div className={styles.page}>
      <div className={styles.searchCard}>
        <Card size="small">
          <SearchTableForm
            name="audit-log-search"
            fields={fields}
            value={table.searchParams}
            onFinish={table.setSearchParams}
            onReset={() => table.setSearchParams({})}
            enableFieldSetting
            fieldSettingCacheKey="audit-log-search-fields"
          />
        </Card>
      </div>
      <Card size="small" className={styles.tableCard}>
        <div ref={toolbarRef} className={styles.optionsHeader}>
          <Space>
            <span>操作审计</span>
          </Space>
          <Button icon={<ReloadOutlined />} onClick={table.reloadTable}>
            刷新
          </Button>
        </div>
        {table.error ? (
          <Alert type="error" message="列表加载失败" />
        ) : (
          <Table<AuditLog>
            rowKey="id"
            size="small"
            dataSource={table.tableData}
            loading={table.loading}
            scroll={{ x: 1100, y: Math.max(80, Math.floor(distance - 140)) }}
            columns={[
              { title: "时间", dataIndex: "time", width: 175 },
              { title: "审计 ID", dataIndex: "id", width: 120 },
              { title: "操作人", dataIndex: "actor", width: 120 },
              { title: "操作", dataIndex: "action", width: 160 },
              { title: "对象", dataIndex: "target", width: 140 },
              {
                title: "结果",
                dataIndex: "result",
                width: 90,
                render: (v: string) => (
                  <Tag color={v === "成功" ? "success" : "warning"}>{v}</Tag>
                ),
              },
              { title: "请求 ID", dataIndex: "requestId", width: 120 },
              {
                title: "操作",
                width: 100,
                fixed: "right",
                render: (_, row) => (
                  <Button
                    type="link"
                    size="small"
                    onClick={() => setDetail(row)}
                  >
                    查看变更
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
        title="操作审计详情"
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
                { key: "id", label: "审计 ID", children: detail.id },
                { key: "time", label: "时间", children: detail.time },
                { key: "actor", label: "操作人", children: detail.actor },
                { key: "action", label: "操作", children: detail.action },
                { key: "target", label: "对象", children: detail.target },
                { key: "result", label: "结果", children: detail.result },
                {
                  key: "requestId",
                  label: "请求 ID",
                  children: detail.requestId,
                },
                { key: "before", label: "变更前", children: detail.before },
                { key: "after", label: "变更后", children: detail.after },
                { key: "env", label: "环境", children: detail.environment },
              ]}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}
