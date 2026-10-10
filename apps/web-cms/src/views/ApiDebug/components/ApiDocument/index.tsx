import { Collapse, Table, Tag } from "antd";
import type { ApiDocument as Document, Schema } from "@/http/services/debug";
import { example, resolveSchema, type Endpoint } from "../../model";
interface Field {
  key: string;
  name: string;
  type: string;
  required: boolean;
  description: string;
  children?: Field[];
}
function fields(
  schema: Schema,
  document: Document,
  prefix = "",
  depth = 0,
): Field[] {
  if (depth > 6) return [];
  schema = resolveSchema(schema, document);
  if (schema.allOf)
    return schema.allOf.flatMap((s) => fields(s, document, prefix, depth + 1));
  if (schema.type === "array")
    return fields(schema.items ?? {}, document, prefix + "[]", depth + 1);
  return Object.entries(schema.properties ?? {}).map(([name, child]) => {
    const actual = resolveSchema(child, document);
    const nested = fields(actual, document, `${prefix}.${name}`, depth + 1);
    return {
      key: `${prefix}.${name}`,
      name,
      type: actual.type ?? (actual.anyOf || actual.oneOf ? "union" : "object"),
      required: !!schema.required?.includes(name),
      description: [
        actual.description,
        actual.format,
        actual.enum ? `可选：${actual.enum.join(" / ")}` : "",
        actual.default !== undefined
          ? `默认：${JSON.stringify(actual.default)}`
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
      ...(nested.length ? { children: nested } : {}),
    };
  });
}
const columns = [
  { title: "字段", dataIndex: "name" },
  { title: "类型", dataIndex: "type", width: 110 },
  {
    title: "必填",
    dataIndex: "required",
    width: 60,
    render: (v: boolean) => (v ? <Tag color="red">是</Tag> : "否"),
  },
  { title: "说明", dataIndex: "description" },
];
export default function ApiDocument({
  endpoint,
  document,
}: {
  endpoint: Endpoint;
  document: Document;
}) {
  const bodySchema =
    endpoint.requestBody?.content?.["application/json"]?.schema;
  return (
    <div>
      <p>{endpoint.description || "参数与响应定义由后端接口自动生成。"}</p>
      <h4>路径、Query 与请求头</h4>
      <Table
        size="small"
        pagination={false}
        columns={[{ title: "位置", dataIndex: "location" }, ...columns]}
        dataSource={(endpoint.parameters ?? []).map((p) => ({
          key: `${p.in}:${p.name}`,
          location: p.in,
          name: p.name,
          type: p.schema?.type ?? "string",
          required: !!p.required,
          description: p.description ?? p.schema?.description ?? "",
        }))}
      />
      {bodySchema && (
        <>
          <h4>请求体</h4>
          <Table
            size="small"
            pagination={false}
            columns={columns}
            dataSource={fields(bodySchema, document)}
          />
        </>
      )}
      {bodySchema && (
        <details style={{ marginTop: 12 }}>
          <summary>请求示例</summary>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(example(bodySchema, document), null, 2)}
          </pre>
        </details>
      )}
      <h4>响应定义</h4>
      <Collapse
        items={Object.entries(endpoint.responses ?? {}).map(
          ([status, value]) => {
            const response = value as {
              description?: string;
              content?: Record<string, { schema?: Schema }>;
            };
            const schema = response.content?.["application/json"]?.schema;
            return {
              key: status,
              label: `${status} · ${response.description || "响应"}`,
              children: schema ? (
                <>
                  <Table
                    size="small"
                    pagination={false}
                    columns={columns}
                    dataSource={fields(schema, document)}
                  />

                  <details style={{ marginTop: 12 }}>
                    <summary>响应示例（根据结构生成）</summary>
                    <pre style={{ whiteSpace: "pre-wrap" }}>
                      {JSON.stringify(example(schema, document), null, 2)}
                    </pre>
                  </details>
                </>
              ) : (
                <span>无结构化响应定义</span>
              ),
            };
          },
        )}
      />
      <details style={{ marginTop: 20 }}>
        <summary>高级：原始 OpenAPI 定义</summary>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {JSON.stringify(endpoint, null, 2)}
        </pre>
      </details>
    </div>
  );
}
