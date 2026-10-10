import { Button, Checkbox, Input, Table, Tooltip } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { Pair } from "../../model";
export default function ParameterTable({
  rows,
  onChange,
  editable = false,
}: {
  rows: Pair[];
  onChange: (rows: Pair[]) => void;
  editable?: boolean;
}) {
  const update = (index: number, patch: Partial<Pair>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  if (!editable && !rows.length)
    return <div style={{ fontSize: 12, color: "#8996a2" }}>无参数</div>;
  return (
    <>
      <Table
        size="small"
        bordered
        pagination={false}
        locale={{ emptyText: "无参数" }}
        dataSource={rows.map((row, i) => ({ ...row, key: i }))}
        columns={[
          {
            title: "启用",
            width: 48,
            render: (_, row) => (
              <Checkbox
                aria-label={`发送 ${row.name || "请求头"}`}
                checked={row.enabled}
                disabled={row.required}
                onChange={(e) => update(row.key, { enabled: e.target.checked })}
              />
            ),
          },
          {
            title: "字段 / 类型",
            width: "37%",
            render: (_, row) =>
              editable ? (
                <Input
                  aria-label="请求头名称"
                  value={row.name}
                  placeholder="Header"
                  onChange={(e) => update(row.key, { name: e.target.value })}
                />
              ) : (
                <Tooltip title={row.description}>
                  <div style={{ overflowWrap: "anywhere" }}>
                    <span style={{ color: "#cf4b40" }}>
                      {row.required ? "* " : ""}
                    </span>
                    {row.name}
                    <div style={{ fontSize: 11, color: "#89939e" }}>
                      {row.type ?? "string"}
                      {row.description ? ` · ${row.description}` : ""}
                    </div>
                  </div>
                </Tooltip>
              ),
          },
          {
            title: "值",
            render: (_, row) => (
              <Input
                aria-label={row.name || "请求头值"}
                value={row.value}
                placeholder="输入值"
                onChange={(e) => update(row.key, { value: e.target.value })}
              />
            ),
          },
          ...(editable
            ? [
                {
                  title: "",
                  width: 36,
                  render: (_: unknown, row: Pair & { key: number }) => (
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined />}
                      aria-label={`删除请求头 ${row.name}`}
                      onClick={() =>
                        onChange(rows.filter((_, i) => i !== row.key))
                      }
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
      {editable && (
        <Button
          type="dashed"
          block
          icon={<PlusOutlined />}
          style={{ marginTop: 8 }}
          onClick={() =>
            onChange([...rows, { name: "", value: "", enabled: true }])
          }
        >
          添加请求头
        </Button>
      )}
    </>
  );
}
