import { useEffect, useRef, useState } from "react";
import { App, Checkbox, Input, Modal } from "antd";
import {
  Copy,
  Plus,
  Trash2,
  PencilLine,
  KeyRound,
  ShieldCheck,
  Eye,
} from "lucide-react";
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
    [expiryMode, setExpiryMode] = useState("90");
  const [busy, setBusy] = useState(false),
    [secret, setSecret] = useState("");
  const [revealed, setRevealed] = useState<{
    id: string;
    secret: string;
  } | null>(null);
  const [revealing, setRevealing] = useState<string | null>(null);
  const [template, setTemplate] = useState<"http" | "mcp">("http");
  const currentScope = `${userId}:${spaceId}`;
  const context = useRef(currentScope);
  context.current = currentScope;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setKeys([]);
    setOpen(false);
    setSecret("");
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
      await navigator.clipboard.writeText(text);
      message.success("已复制");
    } catch {
      message.error("复制失败，请手动选择内容");
    }
  };
  const edit = (key: ApiKey | null) => {
    setEditing(key);
    setName(key?.name ?? "");
    setScope(key?.permissions ?? ["read"]);
    setExpiryMode(key ? (key.expiresAt ? "custom" : "never") : "90");
    setExpires(key?.expiresAt ? localDate(key.expiresAt) : "");
    setSecret("");
    setOpen(true);
  };
  const save = async () => {
    if (busy || secret) return;
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
        setSecret(result.secret);
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
          <h2>{owner ? "空间 API 密钥" : "我的 API 密钥"}</h2>
          <p className="muted">每把密钥独立授权，用于 HTTP API 和 MCP 接入。</p>
        </div>
        <button className="secondary-button" onClick={() => edit(null)}>
          <Plus size={15} />
          创建密钥
        </button>
      </div>
      <div className={styles.keyList}>
        {keys.length ? (
          keys.map((key) => (
            <div className={styles.keyRow} key={key.id}>
              <div>
                <strong>
                  {key.name}
                  {key.expiresAt &&
                  new Date(key.expiresAt).getTime() <= Date.now()
                    ? " · 已过期"
                    : ""}
                </strong>
                <code>{key.prefix}…</code>
                <p>
                  {key.permissions
                    .map((value) => aiPermissionNames[value])
                    .join("、")}
                </p>
                <p>
                  有效期：
                  {key.expiresAt
                    ? new Date(key.expiresAt).toLocaleString("zh-CN")
                    : "长期有效"}{" "}
                  · 最近使用：
                  {key.lastUsedAt
                    ? new Date(key.lastUsedAt).toLocaleString("zh-CN")
                    : "尚未使用"}
                </p>
                {!key.canReveal && (
                  <p className="muted">
                    旧密钥仅存哈希，完整值无法恢复；可继续使用或重新创建。
                  </p>
                )}
              </div>
              <div className={ui.actions}>
                {key.createdBy === userId && key.canReveal && (
                  <button
                    className="icon-button"
                    disabled={revealing !== null}
                    aria-label={`查看密钥 ${key.name}`}
                    onClick={async () => {
                      const operationScope = currentScope;
                      setRevealing(key.id);
                      try {
                        const value = await aiApi.reveal(key.id);
                        if (context.current === operationScope)
                          setRevealed({ id: key.id, secret: value });
                      } catch (reason) {
                        if (context.current === operationScope)
                          message.error(errorMessage(reason));
                      } finally {
                        if (context.current === operationScope)
                          setRevealing(null);
                      }
                    }}
                  >
                    <Eye size={16} />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={`编辑密钥 ${key.name}`}
                  onClick={() => edit(key)}
                >
                  <PencilLine size={16} />
                </button>
                <button
                  className="icon-button"
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
          ))
        ) : (
          <p className={styles.keyEmpty}>
            还没有密钥，创建一把连接你的 AI 助手。
          </p>
        )}
      </div>
      <div className={styles.sectionTop}>
        <h2>接入配置</h2>
        <span className="muted">使用空间密钥接入以下接口</span>
      </div>
      <div className={styles.codePanel}>
        <div className={styles.codeTabs}>
          <button
            className={template === "http" ? styles.codeActive : ""}
            onClick={() => setTemplate("http")}
          >
            HTTP API
          </button>
          <button
            className={template === "mcp" ? styles.codeActive : ""}
            onClick={() => setTemplate("mcp")}
          >
            MCP
          </button>
          <button
            onClick={() =>
              void copy(aiTemplates(window.location.origin)[template])
            }
          >
            <Copy size={14} />
            复制模板
          </button>
        </div>
        <pre>{aiTemplates(window.location.origin)[template]}</pre>
      </div>
      <Modal
        open={open}
        title={
          secret ? "密钥已创建" : editing ? "编辑空间密钥" : "创建空间密钥"
        }
        width={560}
        onCancel={() => {
          if (!busy) {
            setOpen(false);
            setSecret("");
          }
        }}
        onOk={
          secret
            ? () => {
                setOpen(false);
                setSecret("");
              }
            : () => void save()
        }
        okText={secret ? "完成" : editing ? "保存修改" : "创建密钥"}
        cancelText="取消"
        confirmLoading={busy}
        closable={!busy}
        maskClosable={!busy}
        keyboard={!busy}
        cancelButtonProps={{ style: secret ? { display: "none" } : undefined }}
      >
        {secret ? (
          <>
            <div className={ui.intro}>
              <KeyRound size={24} />
              <div>
                <strong>准备好连接 AI 了</strong>
                <p>你也可以稍后在密钥列表中查看和复制。</p>
              </div>
            </div>
            <div className={styles.secret}>
              <code>{secret}</code>
              <button
                className="icon-button"
                aria-label="复制完整 API 密钥"
                onClick={() => void copy(secret)}
              >
                <Copy size={16} />
              </button>
            </div>
            <div className={styles.codePanel}>
              <div className={styles.codeTabs}>
                <button
                  className={template === "http" ? styles.codeActive : ""}
                  onClick={() => setTemplate("http")}
                >
                  HTTP API
                </button>
                <button
                  className={template === "mcp" ? styles.codeActive : ""}
                  onClick={() => setTemplate("mcp")}
                >
                  MCP
                </button>
                <button
                  onClick={() =>
                    void copy(
                      aiTemplates(window.location.origin)[template].replaceAll(
                        "<API_KEY>",
                        secret,
                      ),
                    )
                  }
                >
                  <Copy size={14} />
                  复制配置
                </button>
              </div>
              <pre>
                {aiTemplates(window.location.origin)[template].replaceAll(
                  "<API_KEY>",
                  secret,
                )}
              </pre>
            </div>
          </>
        ) : (
          <>
            <div className={ui.intro}>
              <ShieldCheck size={24} />
              <div>
                <strong>为这个助手选择合适的权限</strong>
                <p>
                  实际访问仍受你的文件权限限制。不会开放空间、成员或分享权限管理。
                </p>
              </div>
            </div>
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
                权限预设{" "}
                <span className="muted">· {preset?.name ?? "自定义"}</span>
              </label>
              <div className={ui.presets}>
                {presets.map((item) => (
                  <button
                    key={item.id}
                    disabled={busy}
                    className={preset?.id === item.id ? ui.selected : ""}
                    aria-pressed={preset?.id === item.id}
                    onClick={() => setScope([...item.permissions])}
                  >
                    <strong>{item.name}</strong>
                    <span>{item.detail}</span>
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
                  <Checkbox key={value} value={value}>
                    <strong>{aiPermissionNames[value]}</strong>
                    <span>{permissionHints[value]}</span>
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
          </>
        )}
      </Modal>
      <Modal
        open={revealed !== null}
        title="查看完整密钥"
        width={520}
        footer={null}
        onCancel={() => setRevealed(null)}
      >
        <p className="muted">此密钥拥有配置的操作权限，请妥善保管。</p>
        <div className={styles.secret}>
          <code>{revealed?.secret}</code>
          <button
            className="icon-button"
            aria-label="复制密钥"
            onClick={() => revealed && void copy(revealed.secret)}
          >
            <Copy size={16} />
          </button>
        </div>
      </Modal>
    </>
  );
}
