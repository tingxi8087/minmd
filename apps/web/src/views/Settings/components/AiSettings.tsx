import { copyText } from "@/utils/clipboard";
import { useEffect, useRef, useState } from "react";
import { App, Checkbox, Input, Modal, Tooltip } from "antd";
import { Copy, Plus, Trash2, PencilLine, Eye, EyeOff } from "lucide-react";
import {
  aiApi,
  aiPermissionNames,
  aiTemplates,
  type AiPermission,
  type ApiKey,
} from "@/api/ai";
import { useAuth } from "@/store/auth";
import { errorMessage } from "@/http";
import styles from "../index.module.less";
import ui from "./AiSettings.module.less";
const permissions = Object.keys(aiPermissionNames) as AiPermission[];
const presets: {
  id: string;
  name: string;
  detail: string;
  permissions: AiPermission[];
}[] = [
  {
    id: "read",
    name: "只读助手",
    detail: "搜索、阅读与总结",
    permissions: ["read"],
  },
  {
    id: "edit",
    name: "内容编辑",
    detail: "阅读与修改现有内容",
    permissions: ["read", "edit"],
  },
  {
    id: "organize",
    name: "内容整理",
    detail: "创建、编辑、整理与上传",
    permissions: ["read", "create", "edit", "organize", "upload"],
  },
  { id: "full", name: "完整文件操作", detail: "含删除与恢复文件", permissions },
];
const permissionHints: Record<AiPermission, string> = {
  read: "读取目录、文档和表格",
  create: "创建文档、表格与文件夹",
  edit: "修改文档正文和单元格",
  organize: "调整名称与目录位置",
  delete_restore: "移入回收站或恢复",
  upload: "上传图片与附件",
};
const localDate = (date: string) => {
  const value = new Date(date);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export default function AiSettings({
  spaceId,
  owner,
}: {
  spaceId: string;
  owner: boolean;
}) {
  const { message, modal } = App.useApp();
  const userId = useAuth((state) => state.user?.id);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<ApiKey | null>(null);
  const [name, setName] = useState(""),
    [scope, setScope] = useState<AiPermission[]>(["read"]);
  const [expires, setExpires] = useState(""),
    [expiryMode, setExpiryMode] = useState("never");
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<{
    id: string;
    secret: string;
    scope: string;
  } | null>(null);
  const [revealing, setRevealing] = useState<string | null>(null);
  const [template, setTemplate] = useState<"http" | "mcp">("mcp");
  const [configKey, setConfigKey] = useState<
    (ApiKey & { scope: string }) | null
  >(null);
  const fetchingSecret = useRef(false);
  const generation = useRef(0);
  const invalidatedKeys = useRef(new Set<string>());
  const currentScope = `${userId}:${spaceId}`;
  const context = useRef(currentScope);
  context.current = currentScope;
  useEffect(() => {
    const controller = new AbortController();
    generation.current++;
    fetchingSecret.current = false;
    invalidatedKeys.current.clear();
    setConfigKey(null);
    setLoading(true);
    setError("");
    setKeys([]);
    setOpen(false);
    setRevealed(null);
    setBusy(false);
    setRevealing(null);
    void aiApi
      .keys(spaceId, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setKeys(items);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      context.current = "";
    };
  }, [spaceId, userId, reload]);
  const copy = async (text: string) => {
    try {
      await copyText(text);
      message.success("已复制");
    } catch {
      message.error("复制失败，请手动选择内容");
    }
  };
  const withSecret = async (
    keyId: string,
    consume: (value: string) => void | Promise<void>,
  ) => {
    if (fetchingSecret.current) return;
    fetchingSecret.current = true;
    setRevealing(keyId);
    const requestScope = currentScope,
      requestGeneration = generation.current;
    const active = () =>
      context.current === requestScope &&
      generation.current === requestGeneration &&
      !invalidatedKeys.current.has(keyId);
    try {
      const value = await aiApi.reveal(keyId);
      if (active()) await consume(value);
    } catch (reason) {
      if (active()) message.error(errorMessage(reason));
    } finally {
      if (
        context.current === requestScope &&
        generation.current === requestGeneration
      ) {
        fetchingSecret.current = false;
        setRevealing(null);
      }
    }
  };
  const connection = (key: ApiKey) => {
    setTemplate("mcp");
    setConfigKey({ ...key, scope: currentScope });
  };
  const edit = (key: ApiKey | null) => {
    setEditing(key);
    setName(key?.name ?? "");
    setScope(key?.permissions ?? ["read"]);
    setExpiryMode(key ? (key.expiresAt ? "custom" : "never") : "never");
    setExpires(key?.expiresAt ? localDate(key.expiresAt) : "");
    setOpen(true);
  };
  const save = async () => {
    if (busy) return;
    if (!name.trim()) {
      message.warning("请输入密钥名称");
      return;
    }
    if (!scope.length) {
      message.warning("请选择至少一项操作权限");
      return;
    }
    const expiresAt =
      expiryMode === "never"
        ? null
        : expiryMode === "custom"
          ? expires
            ? new Date(expires).toISOString()
            : ""
          : new Date(Date.now() + Number(expiryMode) * 86400000).toISOString();
    if (
      expiresAt === "" ||
      (expiresAt && new Date(expiresAt).getTime() <= Date.now())
    ) {
      message.warning("请选择晚于当前时间的有效期");
      return;
    }
    const operationScope = currentScope;
    setBusy(true);
    try {
      const input = { name: name.trim(), permissions: scope, expiresAt };
      if (editing) {
        const updated = await aiApi.update(editing.id, input);
        if (context.current !== operationScope) return;
        setKeys((items) =>
          items.map((item) => (item.id === updated.id ? updated : item)),
        );
        setOpen(false);
        message.success("密钥设置已更新");
      } else {
        const result = await aiApi.create(spaceId, input);
        if (context.current !== operationScope) return;
        setKeys((items) => [result.key, ...items]);
        setOpen(false);
        message.success("密钥已创建，可在列表查看和复制");
      }
    } catch (reason) {
      if (context.current === operationScope)
        message.error(errorMessage(reason));
    } finally {
      if (context.current === operationScope) setBusy(false);
    }
  };
  const preset = presets.find(
    (item) =>
      item.permissions.length === scope.length &&
      item.permissions.every((permission) => scope.includes(permission)),
  );
  if (loading) return <p role="status">正在读取空间密钥…</p>;
  if (error)
    return (
      <p role="alert">
        {error}
        <button
          className="secondary-button"
          onClick={() => setReload((value) => value + 1)}
        >
          重试
        </button>
      </p>
    );
  return (
    <>
      <div className={styles.sectionTop}>
        <div>
          <h2>
            {owner ? "空间 API 密钥" : "我的 API 密钥"}
            {keys.length > 0 && <small>{keys.length}</small>}
          </h2>
        </div>
        <button className="secondary-button" onClick={() => edit(null)}>
          <Plus size={15} />
          创建密钥
        </button>
      </div>
      <div className={`${styles.keyList} ${ui.keyList}`}>
        {keys.length ? (
          keys.map((key) => {
            const keyPreset = presets.find(
              (item) =>
                item.permissions.length === key.permissions.length &&
                item.permissions.every((permission) =>
                  key.permissions.includes(permission),
                ),
            );
            const visible =
              revealed?.id === key.id && revealed.scope === currentScope;
            const expired = Boolean(
              key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now(),
            );
            return (
              <div className={ui.keyRow} key={key.id}>
                <div className={ui.keyIdentity}>
                  <div className={ui.keyHeading}>
                    <strong title={key.name}>{key.name}</strong>
                    <Tooltip
                      trigger={["hover", "focus"]}
                      title={
                        <div className={ui.keyDetails}>
                          <span>
                            {key.createdBy === userId
                              ? "由我创建"
                              : "由其他空间成员创建"}
                          </span>
                          <span>
                            创建：
                            {new Date(key.createdAt).toLocaleString("zh-CN")}
                          </span>
                          <span>
                            最近使用：
                            {key.lastUsedAt
                              ? new Date(key.lastUsedAt).toLocaleString("zh-CN")
                              : "尚未使用"}
                          </span>
                          {!key.canReveal && (
                            <span>
                              旧密钥无法恢复完整值，可继续使用或重新创建。
                            </span>
                          )}
                        </div>
                      }
                    >
                      <code tabIndex={0}>{key.prefix}…</code>
                    </Tooltip>
                  </div>
                  <div className={ui.keySecret}>
                    <input
                      readOnly
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={`密钥 ${key.name}`}
                      type={visible ? "text" : "password"}
                      value={visible ? revealed.secret : "********************"}
                    />
                    <button
                      className="icon-button"
                      disabled={
                        !key.canReveal ||
                        key.createdBy !== userId ||
                        (revealing !== null && !visible)
                      }
                      title={
                        !key.canReveal
                          ? "旧密钥无法恢复完整值"
                          : key.createdBy !== userId
                            ? "只能查看自己创建的密钥"
                            : visible
                              ? "隐藏密钥"
                              : "显示密钥"
                      }
                      aria-label={`${visible ? "隐藏" : "查看"}密钥 ${key.name}`}
                      onClick={() => {
                        if (visible) setRevealed(null);
                        else
                          void withSecret(key.id, (value) =>
                            setRevealed({
                              id: key.id,
                              secret: value,
                              scope: currentScope,
                            }),
                          );
                      }}
                    >
                      {visible ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                    <button
                      className="icon-button"
                      disabled={
                        !key.canReveal ||
                        key.createdBy !== userId ||
                        revealing !== null
                      }
                      title={
                        !key.canReveal
                          ? "旧密钥无法恢复完整值"
                          : key.createdBy !== userId
                            ? "只能复制自己创建的密钥"
                            : "复制完整密钥"
                      }
                      aria-label={`复制密钥 ${key.name}`}
                      onClick={() => void withSecret(key.id, copy)}
                    >
                      <Copy size={15} />
                    </button>
                  </div>
                </div>
                <div className={ui.keyMeta}>
                  <Tooltip
                    trigger={["hover", "focus"]}
                    title={
                      <div className={ui.keyDetails}>
                        {key.permissions.map((permission) => (
                          <span key={permission}>
                            {aiPermissionNames[permission]}
                          </span>
                        ))}
                      </div>
                    }
                  >
                    <span
                      tabIndex={0}
                      className={ui.permissionBadge}
                      aria-label={`权限：${key.permissions.map((permission) => aiPermissionNames[permission]).join("、")}`}
                    >
                      {keyPreset?.name ??
                        `自定义 · ${key.permissions.length} 项`}
                    </span>
                  </Tooltip>
                  <Tooltip
                    trigger={["hover", "focus"]}
                    title={
                      key.expiresAt
                        ? `到期：${new Date(key.expiresAt).toLocaleString("zh-CN")}`
                        : "永久有效"
                    }
                  >
                    <span
                      tabIndex={0}
                      className={`${ui.keyExpiry} ${expired ? ui.expired : ""}`}
                    >
                      {expired
                        ? "已过期"
                        : key.expiresAt
                          ? `${new Date(key.expiresAt).toLocaleDateString("zh-CN")} 到期`
                          : "永久"}
                    </span>
                  </Tooltip>
                </div>
                <div className={ui.actions}>
                  <button
                    className="secondary-button"
                    disabled={!key.canReveal || key.createdBy !== userId}
                    title={
                      !key.canReveal
                        ? "旧密钥无法生成含完整密钥的配置，请重新创建"
                        : key.createdBy !== userId
                          ? "只能获取自己创建的密钥配置"
                          : "查看并复制接入配置"
                    }
                    aria-label={`接入配置 ${key.name}`}
                    onClick={() => connection(key)}
                  >
                    接入配置
                  </button>
                  <button
                    className="icon-button"
                    title="编辑密钥"
                    aria-label={`编辑密钥 ${key.name}`}
                    onClick={() => edit(key)}
                  >
                    <PencilLine size={16} />
                  </button>
                  <button
                    className="icon-button"
                    title="删除密钥"
                    aria-label={`删除密钥 ${key.name}`}
                    onClick={() => {
                      const operationScope = currentScope;
                      modal.confirm({
                        title: `删除「${key.name}」？`,
                        content: "删除后使用此密钥的 AI 将无法继续访问。",
                        okText: "删除",
                        okButtonProps: { danger: true },
                        cancelText: "取消",
                        onOk: async () => {
                          if (context.current !== operationScope) return;
                          try {
                            await aiApi.revoke(key.id);
                          } catch (reason) {
                            if (context.current === operationScope)
                              message.error(errorMessage(reason));
                            throw reason;
                          }
                          if (context.current !== operationScope) return;
                          setKeys((items) =>
                            items.filter((item) => item.id !== key.id),
                          );
                          invalidatedKeys.current.add(key.id);
                          setConfigKey((value) =>
                            value?.id === key.id ? null : value,
                          );
                          setRevealed((value) =>
                            value?.id === key.id ? null : value,
                          );
                        },
                      });
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <p className={styles.keyEmpty}>
            还没有密钥，创建一把连接你的 AI 助手。
          </p>
        )}
      </div>
      <Modal
        open={open}
        title={editing ? "编辑空间密钥" : "创建空间密钥"}
        width={560}
        onCancel={() => {
          if (!busy) {
            setOpen(false);
          }
        }}
        onOk={() => void save()}
        okText={editing ? "保存修改" : "创建密钥"}
        cancelText="取消"
        confirmLoading={busy}
        closable={!busy}
        maskClosable={!busy}
        keyboard={!busy}
        cancelButtonProps={{ disabled: busy }}
      >
        <div className="field">
          <label htmlFor="ai-key-name">密钥名称</label>
          <Input
            id="ai-key-name"
            autoFocus
            value={name}
            maxLength={80}
            disabled={busy}
            placeholder="例如：写作助手"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="field">
          <label>
            权限预设 <span className="muted">· {preset?.name ?? "自定义"}</span>
          </label>
          <div className={ui.presets}>
            {presets.map((item) => (
              <button
                key={item.id}
                disabled={busy}
                className={preset?.id === item.id ? ui.selected : ""}
                aria-pressed={preset?.id === item.id}
                title={item.detail}
                onClick={() => setScope([...item.permissions])}
              >
                <strong>{item.name}</strong>
              </button>
            ))}
          </div>
        </div>
        <div className={ui.permissions}>
          <Checkbox.Group
            value={scope}
            disabled={busy}
            onChange={(values) => setScope(values as AiPermission[])}
          >
            {permissions.map((value) => (
              <Checkbox
                key={value}
                value={value}
                title={permissionHints[value]}
              >
                <strong>{aiPermissionNames[value]}</strong>
              </Checkbox>
            ))}
          </Checkbox.Group>
        </div>
        <div className="field">
          <label>有效期</label>
          <div className={ui.expiry}>
            {[
              { id: "30", name: "30 天" },
              { id: "90", name: "90 天" },
              { id: "never", name: "永久" },
              { id: "custom", name: "自定义" },
            ].map((item) => (
              <button
                key={item.id}
                disabled={busy}
                className={expiryMode === item.id ? ui.selected : ""}
                aria-pressed={expiryMode === item.id}
                onClick={() => setExpiryMode(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
          {expiryMode === "custom" && (
            <input
              type="datetime-local"
              aria-label="密钥有效期"
              value={expires}
              disabled={busy}
              onChange={(event) => setExpires(event.target.value)}
            />
          )}
        </div>
      </Modal>
      <Modal
        open={configKey !== null && configKey.scope === currentScope}
        title={configKey ? `${configKey.name} · 接入配置` : "接入配置"}
        width={560}
        onCancel={() => setConfigKey(null)}
        footer={
          <>
            <button
              className="secondary-button"
              onClick={() => setConfigKey(null)}
            >
              关闭
            </button>
            <button
              className="primary-button"
              disabled={
                revealing !== null ||
                !configKey ||
                configKey.scope !== currentScope ||
                !keys.some((key) => key.id === configKey.id)
              }
              aria-label={`复制 ${template === "mcp" ? "MCP" : "HTTP"} 接入配置`}
              onClick={() => {
                if (!configKey || configKey.scope !== currentScope) return;
                const selectedTemplate = aiTemplates(window.location.origin)[
                  template
                ];
                void withSecret(configKey.id, (value) =>
                  copy(selectedTemplate.replaceAll("<API_KEY>", value)),
                );
              }}
            >
              <Copy size={15} />
              {revealing === configKey?.id ? "正在复制…" : "复制配置"}
            </button>
          </>
        }
      >
        <p className={ui.configHint}>
          预览已遮蔽密钥，复制的配置包含完整密钥，可直接使用。
        </p>
        <div className={styles.codePanel}>
          <div className={`${styles.codeTabs} ${ui.configTabs}`}>
            <button
              disabled={revealing !== null}
              className={template === "mcp" ? styles.codeActive : ""}
              onClick={() => setTemplate("mcp")}
            >
              MCP
            </button>
            <button
              disabled={revealing !== null}
              className={template === "http" ? styles.codeActive : ""}
              onClick={() => setTemplate("http")}
            >
              HTTP API
            </button>
          </div>
          <pre>
            {aiTemplates(window.location.origin)[template].replaceAll(
              "<API_KEY>",
              "••••••••••••",
            )}
          </pre>
        </div>
      </Modal>
    </>
  );
}
