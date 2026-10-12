import { useEffect, useState } from "react";
import { App, Checkbox, Input, Modal, Switch } from "antd";
import { Copy, Plus, Trash2 } from "lucide-react";
import {
  aiApi,
  aiPermissionNames,
  aiTemplates,
  type AiPermission,
  type AiPolicy,
  type ApiKey,
} from "@/api/ai";
import { errorMessage } from "@/http";
import styles from "../index.module.less";
const permissions = Object.keys(aiPermissionNames) as AiPermission[];
export default function AiSettings({
  spaceId,
  owner,
}: {
  spaceId: string;
  owner: boolean;
}) {
  const { message, modal } = App.useApp();
  const [policy, setPolicy] = useState<AiPolicy | null>(null);
  const [savedPolicy, setSavedPolicy] = useState<AiPolicy | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<AiPermission[]>([]);
  const [expires, setExpires] = useState("");
  const [secret, setSecret] = useState("");
  const [creating, setCreating] = useState(false);
  const [template, setTemplate] = useState<"http" | "mcp">("http");
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void Promise.all([
      aiApi.policy(spaceId, controller.signal),
      aiApi.keys(spaceId, controller.signal),
    ])
      .then(([policy, keys]) => {
        if (active) {
          setPolicy(policy);
          setSavedPolicy(policy);
          setKeys(keys);
        }
      })
      .catch((error: unknown) => {
        if (active) setError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [spaceId, reload]);
  const save = async () => {
    if (!policy || saving) return;
    setSaving(true);
    try {
      const result = await aiApi.savePolicy(spaceId, policy);
      setPolicy(result);
      setSavedPolicy(result);
      message.success("空间 AI 策略已保存");
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  const closeCreate = () => {
    if (creating) return;
    if (secret)
      modal.confirm({
        title: "完整密钥仅显示这一次",
        content: "关闭后无法再查看，请确认已复制并妥善保存。",
        okText: "已保存，关闭",
        cancelText: "继续查看",
        onOk: () => {
          setSecret("");
          setCreateOpen(false);
        },
      });
    else setCreateOpen(false);
  };
  const create = async () => {
    if (creating || secret || !savedPolicy?.enabled) return;
    if (!name.trim()) {
      message.warning("请输入密钥名称");
      return;
    }
    if (
      !scope.length ||
      scope.some((value) => !savedPolicy.permissions.includes(value))
    ) {
      message.warning("请选择空间策略允许的权限");
      return;
    }
    if (expires && new Date(expires).getTime() <= Date.now()) {
      message.warning("有效期需要晚于当前时间");
      return;
    }
    setCreating(true);
    try {
      const result = await aiApi.create(spaceId, {
        name: name.trim(),
        permissions: scope,
        expiresAt: expires ? new Date(expires).toISOString() : null,
      });
      setSecret(result.secret);
      setKeys((keys) => [result.key, ...keys]);
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setCreating(false);
    }
  };
  const text = aiTemplates(window.location.origin)[template];
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success("已复制");
    } catch {
      message.error("复制失败，请手动选择内容");
    }
  };
  if (loading) return <p role="status">正在读取空间 AI 设置…</p>;
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
      <div className={styles.settingRow}>
        <div>
          <strong>允许 AI 访问此空间</strong>
          <p>
            仅开放下面勾选的操作，创建空间、成员管理及权限管理不会授权给 AI。
          </p>
        </div>
        <Switch
          checked={policy?.enabled}
          disabled={!owner || saving}
          onChange={(enabled) =>
            setPolicy((value) => value && { ...value, enabled })
          }
          aria-label="空间 AI 总开关"
        />
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <Checkbox.Group
          value={policy?.permissions}
          disabled={!owner || saving}
          options={permissions.map((value) => ({
            value,
            label: aiPermissionNames[value],
          }))}
          onChange={(values) =>
            setPolicy(
              (value) =>
                value && { ...value, permissions: values as AiPermission[] },
            )
          }
        />
        {owner ? (
          <button
            className="secondary-button"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "正在保存…" : "保存空间策略"}
          </button>
        ) : (
          <span className="muted">空间策略由负责人设置。</span>
        )}
      </div>
      <div className={styles.sectionTop}>
        <h2>我的 API 密钥</h2>
        <button
          className="secondary-button"
          disabled={!savedPolicy?.enabled}
          onClick={() => {
            setName("");
            setExpires("");
            setSecret("");
            setScope(
              savedPolicy?.permissions.includes("read")
                ? ["read"]
                : (savedPolicy?.permissions.slice(0, 1) ?? []),
            );
            setCreateOpen(true);
          }}
        >
          <Plus size={15} />
          创建密钥
        </button>
      </div>
      <div className={styles.keyList}>
        {keys.length ? (
          keys.map((key) => (
            <div key={key.id} className={styles.keyRow}>
              <div>
                <strong>
                  {key.name}{" "}
                  {key.revokedAt
                    ? "· 已撤销"
                    : key.expiresAt &&
                        new Date(key.expiresAt).getTime() <= Date.now()
                      ? "· 已过期"
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
                    ? new Date(key.expiresAt).toLocaleString()
                    : "长期"}{" "}
                  · 最近调用：
                  {key.lastUsedAt
                    ? new Date(key.lastUsedAt).toLocaleString()
                    : "尚未使用"}
                </p>
              </div>
              <button
                className="icon-button"
                disabled={Boolean(key.revokedAt)}
                aria-label={`撤销密钥 ${key.name}`}
                onClick={() =>
                  modal.confirm({
                    title: "撤销 API 密钥？",
                    content: `${key.name} 将立即停止访问此空间。`,
                    okText: "撤销",
                    cancelText: "取消",
                    onOk: async () => {
                      try {
                        await aiApi.revoke(key.id);
                        setReload((value) => value + 1);
                      } catch (error) {
                        message.error(errorMessage(error));
                        throw error;
                      }
                    },
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))
        ) : (
          <p className={styles.keyEmpty}>暂无密钥</p>
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
          <button onClick={() => void copy(text)}>
            <Copy size={14} />
            复制模板
          </button>
        </div>
        <pre>{text}</pre>
      </div>
      <Modal
        title={secret ? "保存完整 API 密钥" : "创建 API 密钥"}
        open={createOpen}
        onCancel={closeCreate}
        onOk={secret ? closeCreate : () => void create()}
        okText={secret ? "已保存，关闭" : "创建"}
        cancelText={secret ? "继续查看" : "取消"}
        cancelButtonProps={{ style: secret ? { display: "none" } : undefined }}
        confirmLoading={creating}
        maskClosable={!secret && !creating}
        keyboard={!secret && !creating}
        closable={!creating}
      >
        {secret ? (
          <>
            <p>完整密钥仅显示一次。离开此页面后无法再次查看。</p>
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
          </>
        ) : (
          <>
            <div className="field">
              <label>密钥名称</label>
              <Input
                autoFocus
                aria-label="密钥名称"
                value={name}
                maxLength={80}
                disabled={creating}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="field">
              <label>操作权限</label>
              <Checkbox.Group
                value={scope}
                options={(savedPolicy?.permissions ?? []).map((value) => ({
                  value,
                  label: aiPermissionNames[value],
                }))}
                disabled={creating}
                onChange={(values) => setScope(values as AiPermission[])}
              />
            </div>
            <div className="field">
              <label>有效期（可选）</label>
              <input
                type="datetime-local"
                aria-label="密钥有效期"
                value={expires}
                disabled={creating}
                onChange={(event) => setExpires(event.target.value)}
              />
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
