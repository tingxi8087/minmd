import type { JsonEditorRef } from "./components/JsonEditor";
import { lazy, Suspense } from "react";
import ParameterTable from "./components/ParameterTable";
import ApiDocument from "./components/ApiDocument";
const JsonEditor = lazy(() => import("./components/JsonEditor"));
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Radio,
  Segmented,
  Tree,
  Tooltip,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  message,
} from "antd";
import { ReloadOutlined, SendOutlined } from "@ant-design/icons";
import { useResource } from "@/hooks/useResource";
import { authStore } from "@/http/authSession";
import { useAccess } from "@/hooks/useAccess";
import {
  loadDebug,
  executeDebug,
  type DebugInput,
  type DebugResult,
} from "@/http/services/debug";
import {
  curl,
  redact,
  endpoints,
  example,
  makeUrl,
  type Endpoint,
  type Pair,
} from "./model";
import styles from "./index.module.less";

const colors: Record<string, string> = {
  GET: "green",
  POST: "blue",
  PUT: "orange",
  PATCH: "orange",
  DELETE: "red",
};
export default function ApiDebug() {
  const bodyEditor = useRef<JsonEditorRef>(null);
  const resource = useResource(loadDebug, []);
  const canDebug = useAccess("api:debug");
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("");
  const [selected, setSelected] = useState<Endpoint>();
  const [paths, setPaths] = useState<Pair[]>([]);
  const [query, setQuery] = useState<Pair[]>([]);
  const [headers, setHeaders] = useState<Pair[]>([]);
  const [body, setBody] = useState("");
  const [replacement, setReplacement] = useState<string>();
  const [view, setView] = useState("调试");
  const [layout, setLayout] = useState("左右");
  const [responseView, setResponseView] = useState("JSON");
  const [expanded, setExpanded] = useState<React.Key[] | undefined>();
  const [requestTab, setRequestTab] = useState("params");
  const [auth, setAuth] = useState<DebugInput["auth"]>("current");
  const [token, setToken] = useState("");
  const [result, setResult] = useState<DebugResult>();
  const [problem, setProblem] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<
    {
      id: string;
      method: string;
      path: string;
      status: number;
      draft: {
        paths: Pair[];
        query: Pair[];
        headers: Pair[];
        body: string;
        auth: DebugInput["auth"];
      };
    }[]
  >([]);
  const controller = useRef<AbortController>();
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
      controller.current?.abort();
    },
    [],
  );
  const data = resource.data;
  const all = data ? endpoints(data.document) : [];
  const filtered = all.filter(
    (e) =>
      (!method || e.method === method) &&
      `${e.path} ${e.summary ?? ""} ${e.tags?.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const groups = [...new Set(filtered.map((e) => e.tags?.[0] ?? "其他"))];
  function choose(endpoint: Endpoint) {
    sequence.current++;
    controller.current?.abort();
    setLoading(false);
    setSelected(endpoint);
    setReplacement(undefined);
    setRequestTab(
      endpoint.requestBody?.content?.["application/json"] ? "body" : "params",
    );
    setProblem("");
    setResult(undefined);
    setToken("");
    setAuth("current");
    const rows = (where: string) =>
      (endpoint.parameters ?? [])
        .filter((p) => p.in === where)
        .map((p) => ({
          name: p.name,
          required: p.required,
          description: p.description,
          enabled: !!p.required || p.schema?.default !== undefined,
          type: p.schema?.type,
          value:
            /password|token|secret|cookie|authorization|api[-_]?key/i.test(
              p.name,
            ) || p.schema?.default === undefined
              ? ""
              : String(p.schema.default),
        }));
    setPaths(rows("path"));
    setQuery(rows("query"));
    setHeaders(rows("header"));
    const schema = endpoint.requestBody?.content?.["application/json"]?.schema;
    setBody(
      schema && data
        ? JSON.stringify(example(schema, data.document), null, 2)
        : "",
    );
  }
  function input(): DebugInput {
    if (!selected) throw Error("请先选择接口");
    const requestBody = bodyEditor.current?.read() ?? body;
    if (requestBody.trim()) JSON.parse(requestBody);
    if (auth === "custom" && !token.trim()) throw Error("请填写临时 Token");
    const headerValues = Object.fromEntries(
      headers
        .filter((h) => h.enabled && h.name.trim())
        .map((h) => [h.name.trim(), h.value]),
    );
    if (requestBody.trim()) headerValues["Content-Type"] ??= "application/json";
    return {
      method: selected.method,
      url: makeUrl(selected.path, paths, query),
      headers: headerValues,
      body: requestBody.trim() || undefined,
      auth,
      token: auth === "custom" ? token.trim() : undefined,
    };
  }
  async function send(confirmWrite = false) {
    let value: DebugInput;
    try {
      value = input();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "请求参数错误");
      return;
    }
    const safeRows = (rows: Pair[]) =>
      rows.map((row) => ({
        ...row,
        value: String(redact(row.value, row.name, "")),
      }));
    const draft = {
      paths: safeRows(paths),
      query: safeRows(query),
      headers: safeRows(headers),
      body: value.body
        ? JSON.stringify(redact(JSON.parse(value.body), "", ""), null, 2)
        : "",
      auth,
    };
    const id = ++sequence.current;
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setProblem("");
    setResult(undefined);
    try {
      const response = await executeDebug(
        { ...value, confirmWrite },
        current.signal,
      );
      if (sequence.current !== id) return;
      setResult(response);
      // Retain only a sanitized draft in page memory. Secrets must be re-entered.
      setHistory((old) =>
        [
          {
            id: selected?.id ?? "",
            method: selected?.method ?? "",
            path: selected?.path ?? "",
            status: response.status,
            draft,
          },
          ...old,
        ].slice(0, 15),
      );
    } catch (e) {
      if (sequence.current !== id) return;
      const code = (e as { code?: string }).code;
      setProblem(
        current.signal.aborted
          ? "已取消等待。服务端已经发生的修改不会撤销。"
          : code === "ECONNABORTED"
            ? "请求超时（30 秒），可通过请求日志检查服务端结果。"
            : (e as { response?: unknown }).response
              ? "调试请求被拒绝，请检查权限或环境配置。"
              : "网络连接失败，请检查后端服务。",
      );
    } finally {
      if (sequence.current === id) setLoading(false);
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      message.success("已复制");
    } catch {
      message.error("无法写入剪贴板");
    }
  }
  const productionWrite =
    data?.config.environment === "production" &&
    selected &&
    !["GET", "HEAD", "OPTIONS"].includes(selected.method);
  const disabled = !canDebug || !data?.config.enabled || loading;
  const bodySchema =
    selected?.requestBody?.content?.["application/json"]?.schema;
  let urlPreview = selected?.path ?? "";
  try {
    if (selected) urlPreview = makeUrl(selected.path, paths, query);
  } catch {
    /* incomplete path fields */
  }
  const treeData = groups.map((group) => ({
    key: `group:${group}`,
    title: (
      <span className={styles.group}>
        {group}{" "}
        <span>
          {filtered.filter((e) => (e.tags?.[0] ?? "其他") === group).length}
        </span>
      </span>
    ),
    selectable: false,
    children: filtered
      .filter((e) => (e.tags?.[0] ?? "其他") === group)
      .map((e) => ({
        key: e.id,
        title: (
          <div className={styles.endpoint} aria-label={`${e.method} ${e.path}`}>
            <div>{e.summary ?? e.path}</div>
            <div className={styles.endpointPath}>
              <span
                className={styles.method}
                style={{
                  color: (
                    {
                      GET: "#268366",
                      POST: "#327bb7",
                      PUT: "#a66814",
                      PATCH: "#a66814",
                      DELETE: "#c04b4b",
                    } as Record<string, string>
                  )[e.method],
                }}
              >
                {e.method}
              </span>
              <span title={e.path}>{e.path}</span>
            </div>
          </div>
        ),
      })),
  }));
  const editor = (
    value: string,
    readOnly = false,
    onChange?: (text: string) => void,
    label?: string,
  ) => (
    <Suspense fallback={<Spin />}>
      <JsonEditor
        ref={readOnly ? undefined : bodyEditor}
        value={value}
        readOnly={readOnly}
        onChange={onChange}
        label={label}
      />
    </Suspense>
  );
  const replaceBody = (value: string) => setBody(value);
  const action = (label: string, value: string) => (
    <Popconfirm
      title="覆盖当前已编辑的请求体？"
      open={replacement === label}
      onOpenChange={(open) => {
        if (!open) {
          setReplacement(undefined);
          return;
        }
        const current = bodyEditor.current?.read() ?? body;
        if (current.trim() && current !== value) setReplacement(label);
        else replaceBody(value);
      }}
      onConfirm={() => {
        replaceBody(value);
        setReplacement(undefined);
      }}
    >
      <Button size="small" type="text">
        {label}
      </Button>
    </Popconfirm>
  );
  return (
    <div className={styles.page}>
      <aside className={styles.catalog}>
        <div className={styles.filters}>
          <div className={styles.catalogTitle}>
            <strong>
              接口目录 <span>{all.length}</span>
            </strong>
            <Button
              type="text"
              size="small"
              aria-label="刷新接口目录"
              icon={<ReloadOutlined />}
              loading={resource.loading}
              onClick={() => {
                sequence.current++;
                controller.current?.abort();
                setLoading(false);
                setSelected(undefined);
                resource.reload();
              }}
            />
          </div>
          <Input.Search
            placeholder="搜索路径、说明、分组"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
          />
          <Select
            aria-label="请求方法筛选"
            value={method}
            onChange={setMethod}
            options={[
              { value: "", label: "全部请求方法" },
              ...[
                "GET",
                "POST",
                "PUT",
                "PATCH",
                "DELETE",
                "HEAD",
                "OPTIONS",
              ].map((value) => ({ value, label: value })),
            ]}
          />
        </div>
        <div className={styles.tree}>
          {resource.loading && <Spin />}
          {!!resource.error && (
            <Alert
              type="error"
              message="接口目录加载失败"
              action={<Button onClick={resource.reload}>重试</Button>}
            />
          )}
          {!resource.loading && !filtered.length && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="没有匹配的接口"
            />
          )}
          <Tree
            blockNode
            showLine={false}
            treeData={treeData}
            selectedKeys={selected ? [selected.id] : []}
            expandedKeys={
              search || method
                ? treeData.map((g) => g.key)
                : (expanded ?? treeData.map((g) => g.key))
            }
            onExpand={(keys) => setExpanded(keys)}
            onSelect={(keys) => {
              const endpoint = all.find((e) => e.id === keys[0]);
              if (endpoint) choose(endpoint);
            }}
          />
        </div>
        <div className={styles.catalogFoot}>来自当前后端 · OpenAPI</div>
      </aside>
      <main className={styles.work}>
        <header className={styles.top}>
          <div className={styles.heading}>
            <strong>{selected?.summary ?? "接口调试"}</strong>
            <Tag
              color={data?.config.environment === "production" ? "red" : "cyan"}
            >
              {data?.config.environment ?? "加载中"}
            </Tag>
            {selected && (
              <Tooltip
                title={
                  [
                    selected["x-access"]?.superAdmin ? "仅超级管理员" : "",
                    ...(selected["x-access"]?.permissions ?? []),
                  ]
                    .filter(Boolean)
                    .join(" / ") || "无额外权限要求"
                }
              >
                <span className={styles.hint}>
                  {selected["x-access"]?.auth
                    ? selected["x-access"]?.authScope === "app"
                      ? "需要前台登录 ⓘ"
                      : "需要后台登录 ⓘ"
                    : "公开接口"}
                </span>
              </Tooltip>
            )}
          </div>
          <Space size={8}>
            <Segmented
              value={view}
              onChange={(v) => {
                setBody(bodyEditor.current?.read() ?? body);
                setView(String(v));
              }}
              options={["调试", "文档"]}
            />
            <Select
              style={{ width: 175 }}
              aria-label="最近请求"
              placeholder="最近请求"
              value={null}
              disabled={!history.length}
              onChange={(value: number) => {
                const entry = history[value];
                const endpoint = all.find((e) => e.id === entry.id);
                if (endpoint) {
                  choose(endpoint);
                  setPaths(entry.draft.paths);
                  setQuery(entry.draft.query);
                  setHeaders(entry.draft.headers);
                  setBody(entry.draft.body);
                  setAuth(entry.draft.auth);
                }
              }}
              options={history.map((h, i) => ({
                value: i,
                label: `${h.status} · ${h.method} ${h.path}`,
              }))}
            />
          </Space>
        </header>
        {data && !data.config.enabled && (
          <Alert
            type="warning"
            message="当前环境已关闭在线调试，可查看接口文档。"
          />
        )}
        {!canDebug && (
          <Alert
            type="info"
            message="当前账号仅可查看文档，没有接口调试权限。"
          />
        )}
        {!selected ? (
          <div className={styles.welcome}>
            <Empty description="选择一个接口，开始调试" />
            <span>查看定义、编辑请求，并排检查响应</span>
          </div>
        ) : (
          <>
            <div className={styles.addressBar}>
              <div className={styles.address}>
                <Tag color={colors[selected.method]}>{selected.method}</Tag>
                <span title={window.location.origin + urlPreview}>
                  {window.location.origin + urlPreview}
                </span>
              </div>
              {productionWrite ? (
                <Popconfirm
                  title="确认向正式环境发送写请求？"
                  description="本次操作可能修改真实数据。"
                  onConfirm={() => send(true)}
                  disabled={disabled}
                >
                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    disabled={disabled}
                    loading={loading}
                  >
                    发送请求
                  </Button>
                </Popconfirm>
              ) : (
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={() => send()}
                  disabled={disabled}
                  loading={loading}
                >
                  发送请求
                </Button>
              )}
              {loading && (
                <Button onClick={() => controller.current?.abort()}>
                  取消等待
                </Button>
              )}
              <Tooltip title="复制 cURL（隐藏凭证）">
                <Button
                  aria-label="复制 cURL（隐藏凭证）"
                  onClick={() => {
                    try {
                      void copy(
                        curl(
                          input(),
                          window.location.origin,
                          authStore.$.config?.transport,
                        ),
                      );
                    } catch (e) {
                      message.error(
                        e instanceof Error ? e.message : "参数不完整",
                      );
                    }
                  }}
                >
                  cURL
                </Button>
              </Tooltip>
            </div>
            {problem && (
              <Alert
                closable
                onClose={() => setProblem("")}
                type="error"
                showIcon
                message={problem}
              />
            )}
            {view === "文档" ? (
              <div className={styles.docs}>
                <ApiDocument
                  endpoint={selected}
                  document={data?.document ?? { paths: {} }}
                />
              </div>
            ) : (
              <>
                <div className={styles.layoutBar}>
                  <span>当前后端 · 请求与响应</span>
                  <Segmented
                    size="small"
                    aria-label="面板布局"
                    value={layout}
                    onChange={(v) => setLayout(String(v))}
                    options={["左右", "上下"]}
                  />
                </div>
                <div
                  className={`${styles.panels} ${layout === "上下" ? styles.stacked : ""}`}
                >
                  <section className={styles.panel} aria-label="请求面板">
                    <div className={styles.panelTitle}>
                      <strong>请求</strong>
                      <span>
                        {auth === "current"
                          ? "当前登录身份"
                          : auth === "none"
                            ? "匿名请求"
                            : "临时 Token"}
                      </span>
                    </div>
                    <Tabs
                      size="small"
                      activeKey={requestTab}
                      onChange={(value) => {
                        setBody(bodyEditor.current?.read() ?? body);
                        setRequestTab(value);
                      }}
                      items={[
                        {
                          key: "params",
                          label: `参数 (${paths.length + query.length})`,
                        },
                        { key: "headers", label: `请求头 (${headers.length})` },
                        { key: "body", label: "请求体" },
                        { key: "auth", label: "认证" },
                      ]}
                    />
                    <div
                      className={`${styles.panelContent} ${requestTab === "body" && bodySchema ? styles.editorContent : ""}`}
                    >
                      {requestTab === "params" && (
                        <>
                          {paths.length > 0 && (
                            <>
                              <div className={styles.sectionLabel}>
                                路径参数
                              </div>
                              <ParameterTable
                                rows={paths}
                                onChange={setPaths}
                              />
                            </>
                          )}
                          <div className={styles.sectionLabel}>Query 参数</div>
                          <ParameterTable rows={query} onChange={setQuery} />
                        </>
                      )}
                      {requestTab === "headers" && (
                        <>
                          <p className={styles.hint}>
                            认证头由「认证」选项控制，保留请求头无法覆盖。
                          </p>
                          <ParameterTable
                            rows={headers}
                            onChange={setHeaders}
                            editable
                          />
                        </>
                      )}
                      {requestTab === "body" &&
                        (bodySchema ? (
                          <>
                            <div className={styles.editorTools}>
                              <span>application/json</span>
                              <Space size={0}>
                                {action(
                                  "填入示例",
                                  JSON.stringify(
                                    example(
                                      bodySchema,
                                      data?.document ?? { paths: {} },
                                    ),
                                    null,
                                    2,
                                  ),
                                )}
                                <Button
                                  size="small"
                                  type="text"
                                  onClick={() => {
                                    try {
                                      setBody(
                                        JSON.stringify(
                                          JSON.parse(body),
                                          null,
                                          2,
                                        ),
                                      );
                                    } catch {
                                      message.error("JSON 格式不正确");
                                    }
                                  }}
                                >
                                  格式化
                                </Button>
                                {action("清空", "")}
                              </Space>
                            </div>
                            <div className={styles.editorHost}>
                              {editor(body, false, setBody, "JSON 请求体")}
                            </div>
                          </>
                        ) : (
                          <div className={styles.note}>
                            {selected.requestBody
                              ? "目前支持 JSON 请求体"
                              : "此接口无需请求体"}
                          </div>
                        ))}
                      {requestTab === "auth" && (
                        <>
                          <Radio.Group
                            value={auth}
                            onChange={(e) => {
                              setAuth(e.target.value);
                              setToken("");
                            }}
                          >
                            <Space direction="vertical" size={18}>
                              <Radio value="current">当前登录身份</Radio>
                              <Radio value="none">不携带认证</Radio>
                              <Radio value="custom">临时 Bearer Token</Radio>
                            </Space>
                          </Radio.Group>
                          {auth === "custom" && (
                            <Input.Password
                              style={{ marginTop: 16 }}
                              aria-label="临时 Token"
                              placeholder="仅本页内存中使用"
                              value={token}
                              onChange={(e) => setToken(e.target.value)}
                            />
                          )}
                          <p className={styles.hint}>
                            目标接口仍校验业务权限，调试不会绕过鉴权。
                          </p>
                        </>
                      )}
                    </div>
                  </section>
                  <section className={styles.panel} aria-label="响应面板">
                    <div className={styles.panelTitle}>
                      <strong>响应</strong>
                      {result ? (
                        <Space size={8}>
                          <Tag color={result.status < 400 ? "green" : "red"}>
                            HTTP {result.status}
                          </Tag>
                          <span>{result.duration} ms</span>
                        </Space>
                      ) : (
                        <span>{loading ? "请求中…" : "尚未发送"}</span>
                      )}
                    </div>
                    <div className={styles.responseTools}>
                      <Segmented
                        size="small"
                        value={responseView}
                        onChange={(v) => setResponseView(String(v))}
                        options={["JSON", "原文", "响应头"]}
                      />
                      <Button
                        type="text"
                        size="small"
                        disabled={!result}
                        onClick={() => result && copy(result.body)}
                      >
                        复制响应
                      </Button>
                    </div>
                    <div
                      className={`${styles.panelContent} ${result && responseView !== "原文" ? styles.editorContent : ""}`}
                    >
                      {result ? (
                        responseView === "原文" ? (
                          <pre className={styles.raw}>
                            {result.body || "(空响应)"}
                          </pre>
                        ) : (
                          editor(
                            responseView === "响应头"
                              ? JSON.stringify(result.headers, null, 2)
                              : result.body || "null",
                            true,
                            undefined,
                            "响应 JSON",
                          )
                        )
                      ) : (
                        <div className={styles.responseEmpty}>
                          {loading ? (
                            <Spin />
                          ) : (
                            <>
                              <SendOutlined />
                              <strong>等待请求</strong>
                              <span>发送后查看状态、数据和响应头</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    {result && (
                      <div className={styles.requestId}>
                        <Tooltip title="复制请求 ID，便于查询日志">
                          <Button
                            size="small"
                            type="text"
                            onClick={() =>
                              copy(String(result.headers["x-request-id"] ?? ""))
                            }
                          >
                            请求 ID
                          </Button>
                        </Tooltip>
                        <span>
                          {String(result.headers["x-request-id"] ?? "—")}
                        </span>
                      </div>
                    )}
                  </section>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
