import { useEffect, useState } from "react";
import { App, Input, Modal, Switch } from "antd";
import { Copy, Globe2, LockKeyhole, RotateCw } from "lucide-react";
import { sharesApi, shareLink, type ShareStatus } from "@/api/shares";
import { errorMessage } from "@/http";
import type { Entry } from "@/store/workspace";
import { useWorkspace } from "@/store/workspace";
function localDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export default function ShareDialog({
  file,
  close,
}: {
  file: Entry;
  close: () => void;
}) {
  const { message, modal } = App.useApp();
  const loadFiles = useWorkspace((state) => state.loadFiles);
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [shared, setShared] = useState(false);
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [expires, setExpires] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void sharesApi
      .get(file.id)
      .then((result) => {
        if (active) {
          setStatus(result);
          setShared(result.visibility === "public");
          setExpires(localDate(result.expiresAt));
          setPassword("");
          setClearPassword(false);
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
    };
  }, [file.id, reload]);
  const save = async (rotate = false) => {
    if (!status || saving) return;
    if (shared && password && password.length < 4) {
      message.warning("分享密码至少4位");
      return;
    }
    if (shared && expires && new Date(expires).getTime() <= Date.now()) {
      message.warning("有效期需要晚于当前时间");
      return;
    }
    setSaving(true);
    try {
      const result = await sharesApi.save(file.id, {
        visibility: shared ? "public" : "private",
        expiresAt: shared && expires ? new Date(expires).toISOString() : null,
        ...(clearPassword ? { password: null } : password ? { password } : {}),
        ...(rotate ? { rotate: true } : {}),
      });
      setStatus(result);
      setPassword("");
      setClearPassword(false);
      if (result.token) setToken(result.token);
      else if (!result.enabled) setToken("");
      await loadFiles();
      message.success(shared ? "分享设置已保存" : "已转为私有，旧链接已失效");
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  const rotate = () =>
    modal.confirm({
      title: "生成新的公开链接？",
      content: "旧链接将立即失效，新链接请重新分享。",
      okText: "生成新链接",
      cancelText: "取消",
      onOk: () => save(true),
    });
  return (
    <Modal
      title="分享设置"
      open
      onCancel={() => {
        if (!saving) close();
      }}
      onOk={() => void save()}
      okText="保存设置"
      cancelText="关闭"
      confirmLoading={saving}
      okButtonProps={{ disabled: loading || Boolean(error) }}
      closable={!saving}
      maskClosable={!saving}
      keyboard={!saving}
    >
      <p className="dialog-note">{file.name}</p>
      {loading && <p role="status">正在读取分享设置…</p>}
      {error && (
        <p role="alert">
          {error}
          <button
            className="secondary-button"
            onClick={() => setReload(reload + 1)}
          >
            重试
          </button>
        </p>
      )}
      {status && !loading && (
        <>
          <div
            className="field"
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {shared ? <Globe2 size={17} /> : <LockKeyhole size={17} />}
              {shared ? "公开 · 链接只读访问" : "私有 · 仅空间成员访问"}
            </span>
            <Switch
              checked={shared}
              disabled={saving}
              onChange={setShared}
              aria-label="公开分享"
            />
          </div>
          {shared && (
            <>
              <div className="field">
                <label htmlFor="share-password">分享密码</label>
                <Input.Password
                  id="share-password"
                  value={password}
                  maxLength={128}
                  disabled={saving}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setClearPassword(false);
                  }}
                  placeholder={
                    status.hasPassword && !clearPassword
                      ? "已设置密码，留空保持现有密码"
                      : "可选，至少4位"
                  }
                />
                {status.hasPassword && (
                  <button
                    className="secondary-button"
                    disabled={saving}
                    onClick={() => {
                      setClearPassword(true);
                      setPassword("");
                    }}
                  >
                    清除密码
                  </button>
                )}
                {clearPassword && <span>保存后清除密码</span>}
              </div>
              <div className="field">
                <label htmlFor="share-expires">有效期</label>
                <input
                  id="share-expires"
                  type="datetime-local"
                  value={expires}
                  disabled={saving}
                  onChange={(event) => setExpires(event.target.value)}
                  style={{
                    padding: 8,
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    color: "var(--text)",
                  }}
                />
                {expires && (
                  <button
                    className="secondary-button"
                    disabled={saving}
                    onClick={() => setExpires("")}
                  >
                    永久有效
                  </button>
                )}
              </div>
              {token ? (
                <div className="field">
                  <Input
                    readOnly
                    aria-label="公开分享链接"
                    value={shareLink(token)}
                  />
                  <button
                    className="secondary-button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(shareLink(token));
                        message.success("已复制公开链接");
                      } catch {
                        message.error("复制失败，请手动选择链接");
                      }
                    }}
                  >
                    <Copy size={15} />
                    复制链接
                  </button>
                </div>
              ) : (
                status.enabled && (
                  <button
                    className="secondary-button"
                    disabled={saving}
                    onClick={rotate}
                  >
                    <RotateCw size={15} />
                    生成新链接
                  </button>
                )
              )}
              {token && (
                <button
                  className="secondary-button"
                  disabled={saving}
                  onClick={rotate}
                >
                  <RotateCw size={15} />
                  更换链接
                </button>
              )}
            </>
          )}
          {status.enabled && (
            <button
              className="secondary-button"
              disabled={saving}
              onClick={() =>
                modal.confirm({
                  title: "撤销公开分享？",
                  content: "公开链接和访客密码授权将立即失效。",
                  okText: "撤销",
                  cancelText: "取消",
                  onOk: async () => {
                    setSaving(true);
                    try {
                      await sharesApi.revoke(file.id);
                      setShared(false);
                      setToken("");
                      setReload(reload + 1);
                      await loadFiles();
                      message.success("公开分享已撤销");
                    } catch (error) {
                      message.error(errorMessage(error));
                      throw error;
                    } finally {
                      setSaving(false);
                    }
                  },
                })
              }
            >
              撤销公开分享
            </button>
          )}
        </>
      )}
    </Modal>
  );
}
