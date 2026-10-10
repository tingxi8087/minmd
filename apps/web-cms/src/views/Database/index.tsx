import { isAxiosError } from "axios";
import { useRef, useState } from "react";
import {
  Alert,
  Button,
  Empty,
  Input,
  Pagination,
  Popconfirm,
  Segmented,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
} from "antd";
import {
  DatabaseOutlined,
  KeyOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useResource } from "@/hooks/useResource";
import { useBasePageTable } from "@/hooks/useTableHooks";
import { useElementBottomDistance } from "@/hooks/useElementBottomDistance";
import {
  loadDatabase,
  loadTable,
  executeSql,
  type DatabaseTable,
  type TableData,
  type SqlResult,
} from "@/http/services/database";
import styles from "./index.module.less";

const cell = (value: unknown) =>
  value === null ? (
    <span className={styles.null}>NULL</span>
  ) : (
    <span
      title={typeof value === "object" ? JSON.stringify(value) : String(value)}
    >
      {typeof value === "object" ? JSON.stringify(value) : String(value)}
    </span>
  );
const quote = (value: string) => '"' + value.replace(/"/g, '""') + '"';
export default function Database() {
  const catalog = useResource(loadDatabase, []);
  const [selected, setSelected] = useState<DatabaseTable>();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("数据");
  const [sql, setSql] = useState(
    "SELECT current_database(), current_user, now();",
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SqlResult>();
  const [error, setError] = useState("");
  const [executedSql, setExecutedSql] = useState("");
  const marker = useRef<HTMLDivElement>(null);
  const { distance } = useElementBottomDistance(marker);
  const table = useBasePageTable<unknown[], Record<string, never>, TableData>({
    deps: [selected?.schema, selected?.name],
    getTableData: async ({ pageNum, pageSize }) => {
      if (!selected) return { data: [], total: 0 };
      const data = await loadTable(selected, pageNum, pageSize);
      return {
        data: data.rows,
        total: data.total,
        pageNum: data.page,
        meta: data,
      };
    },
  });
  const config = catalog.data?.[1];
  const columns = table.data?.meta?.columns ?? [];
  const tables = (catalog.data?.[0].tables ?? []).filter((t) =>
    `${t.schema}.${t.name} ${t.comment}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const run = async () => {
    if (running || !sql.trim()) return;
    setRunning(true);
    setError("");
    setResult(undefined);
    setExecutedSql(sql);
    try {
      setResult(
        await executeSql(
          sql,
          config?.environment === "production" ? "production" : undefined,
        ),
      );
      table.reloadTable();
      catalog.reload();
    } catch (e) {
      setError(
        isAxiosError(e)
          ? (e.response?.data?.message ??
              "连接中断，执行结果未知；请核查审计后再操作。")
          : (e as Error).message || "执行失败",
      );
    } finally {
      setRunning(false);
    }
  };
  const choose = (item: DatabaseTable) => {
    setSelected(item);
    table.setPageNum(1);
    setTab("数据");
  };
  const browseColumns = columns.map((c, index) => ({
    title: (
      <Tooltip title={`${c.type} · ${c.nullable ? "可空" : "非空"}`}>
        <span>
          {c.primary && <KeyOutlined />} {c.name}
          {c.comment && `（${c.comment}）`}
        </span>
      </Tooltip>
    ),
    key: index,
    width: 200,
    ellipsis: true,
    render: (_: unknown, row: unknown[]) => cell(row[index]),
  }));
  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <header>
          <strong>
            <DatabaseOutlined /> 数据表
          </strong>
          <Button
            aria-label="刷新表目录"
            icon={<ReloadOutlined />}
            type="text"
            loading={catalog.loading}
            onClick={catalog.reload}
          />
        </header>
        <Input.Search
          placeholder="搜索表名或注释"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <nav aria-label="数据表目录">
          {tables.map((t) => (
            <button
              key={`${t.schema}.${t.name}`}
              className={
                selected?.schema === t.schema && selected?.name === t.name
                  ? styles.active
                  : ""
              }
              onClick={() => choose(t)}
            >
              <strong>{t.name}</strong>
              <small>
                {t.schema}
                {t.comment ? ` · ${t.comment}` : ""}
              </small>
            </button>
          ))}
          {!catalog.loading && !tables.length && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无数据表"
            />
          )}
        </nav>
        <footer>当前数据库 · {config?.database ?? "加载中"}</footer>
      </aside>
      <main className={styles.main}>
        <header className={styles.toolbar}>
          <Space>
            <strong>
              {selected
                ? `${selected.schema}.${selected.name}`
                : "数据库工作台"}
            </strong>
            <Tag color={config?.environment === "production" ? "red" : "cyan"}>
              {config?.environment}
            </Tag>
            <Tag>仅超管</Tag>
          </Space>
          <Segmented
            options={["数据", "结构", "SQL"]}
            value={tab}
            onChange={(value) => setTab(String(value))}
          />
        </header>
        {!!catalog.error && <Alert type="error" message="数据库目录加载失败" />}
        {tab !== "SQL" && selected && (
          <div className={styles.tablebar}>
            <span>{selected.comment || "无表注释"}</span>
            <Space>
              <Button
                onClick={() => {
                  setSql(
                    `SELECT * FROM ${quote(selected.schema)}.${quote(selected.name)} LIMIT 100;`,
                  );
                  setTab("SQL");
                }}
              >
                生成查询 SQL
              </Button>
              <Button icon={<ReloadOutlined />} onClick={table.reloadTable}>
                刷新
              </Button>
            </Space>
          </div>
        )}
        {tab !== "SQL" && !selected ? (
          <Empty description="从左侧选择数据表，或切换 SQL 执行语句" />
        ) : tab === "SQL" ? (
          <>
            <div className={styles.sqlbar}>
              <span>单条语句 · 最多 500 行 / 1 MiB · 5 秒超时</span>
              {config?.environment === "production" ? (
                <Popconfirm
                  title="确认在 production 正式数据库执行？"
                  description="语句将使用当前数据库账号权限执行，提交后不能撤销。"
                  onConfirm={run}
                  okText="确认执行"
                  cancelText="取消"
                >
                  <Button
                    type="primary"
                    loading={running}
                    disabled={!sql.trim()}
                    icon={<PlayCircleOutlined aria-hidden />}
                  >
                    执行 SQL
                  </Button>
                </Popconfirm>
              ) : (
                <Button
                  type="primary"
                  loading={running}
                  disabled={!sql.trim()}
                  onClick={run}
                  icon={<PlayCircleOutlined aria-hidden />}
                >
                  执行 SQL
                </Button>
              )}
            </div>
            <Input.TextArea
              className={styles.editor}
              aria-label="SQL 编辑器"
              spellCheck={false}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              disabled={running}
              autoSize={false}
            />
            <div className={styles.hint}>
              每次执行独立事务；失败或超限回滚。SQL
              可直接修改系统数据，执行内容以脱敏摘要记录审计。
            </div>
            {error && <Alert showIcon type="error" message={error} />}
            {result?.auditWarning && (
              <Alert showIcon type="warning" message={result.auditWarning} />
            )}
            <div className={styles.resultbar}>
              <strong>执行结果</strong>
              {result && (
                <Space>
                  <Tag color="green">{result.command}</Tag>
                  <span>影响 {result.affectedRows} 行</span>
                  <span>{result.duration} ms</span>
                </Space>
              )}
              {running && <Spin size="small" />}
            </div>
            <div ref={marker} />
            {result ? (
              <>
                <Table
                  size="small"
                  rowKey={(_, i) => String(i)}
                  columns={result.columns.map((c, index) => ({
                    title: c.name,
                    key: index,
                    width: 200,
                    ellipsis: true,
                    render: (_: unknown, row: unknown[]) => cell(row[index]),
                  }))}
                  dataSource={result.rows}
                  scroll={{
                    x: "max-content",
                    y: Math.max(100, distance - 105),
                  }}
                  pagination={false}
                  locale={{ emptyText: "执行成功，无返回数据" }}
                />
                <div className={styles.hint}>
                  执行编号：{result.executionId}
                  {sql !== executedSql && " · 编辑器已修改，以上为上次执行结果"}
                </div>
              </>
            ) : (
              !running &&
              !error && (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="执行后在这里查看结果"
                />
              )
            )}
          </>
        ) : (
          <>
            {!!table.error && (
              <Alert
                type="error"
                message="表数据加载失败，请刷新重试或使用 SQL 缩小查询范围。"
              />
            )}
            <div ref={marker} />
            {tab === "结构" ? (
              <Table
                size="small"
                rowKey="name"
                loading={table.loading}
                dataSource={columns}
                columns={[
                  { title: "字段", dataIndex: "name" },
                  { title: "类型", dataIndex: "type" },
                  { title: "注释", dataIndex: "comment" },
                  {
                    title: "可空",
                    dataIndex: "nullable",
                    render: (v) => (v ? "是" : "否"),
                  },
                  {
                    title: "主键",
                    dataIndex: "primary",
                    render: (v) => (v ? <Tag color="gold">主键</Tag> : "—"),
                  },
                ]}
                pagination={false}
                scroll={{ y: Math.max(120, distance - 90) }}
              />
            ) : (
              <>
                <Table
                  size="small"
                  loading={table.loading}
                  rowKey={(_, i) => String(i)}
                  columns={browseColumns}
                  dataSource={table.tableData}
                  pagination={false}
                  scroll={{
                    x: "max-content",
                    y: Math.max(120, distance - 140),
                  }}
                />
                <div className={styles.pagination}>
                  <span>密码、令牌、密钥类字段默认隐藏</span>
                  <Pagination
                    current={table.pageNum}
                    pageSize={table.pageSize}
                    total={table.total}
                    showSizeChanger
                    pageSizeOptions={[20, 50, 100]}
                    showTotal={(total) => `共 ${total} 条`}
                    onChange={(page, size) => {
                      if (size !== table.pageSize) table.setPageSize(size);
                      else table.setPageNum(page);
                    }}
                  />
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
