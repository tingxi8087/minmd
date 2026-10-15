import { copyText } from "@/utils/clipboard";
import AccessManager from "./AccessManager";
import FileIcon from "@/components/FileIcon";
import { fileAccessApi } from "@/api/fileAccess";
import { useEffect, useState } from "react";
import { App, Button, Input, Modal, Select, Spin, Switch, Tabs } from "antd";
import { Copy, RotateCw } from "lucide-react";
import { sharesApi, shareLink, type ShareStatus } from "@/api/shares";
import { errorMessage } from "@/http";
import type { Entry } from "@/store/workspace";
import { useWorkspace } from "@/store/workspace";
import styles from "./index.module.less";
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
  const [canManage, setCanManage] = useState(file.permission === "manage");
  const [tab, setTab] = useState("link");
  const [requestCount, setRequestCount] = useState(0);
  const [accessBusy, setAccessBusy] = useState(false);
  const [audience, setAudience] = useState<"authenticated" | "anyone">(
    "anyone",
  );
  const [linkPermission, setLinkPermission] = useState<"read" | "edit">("read");
  const [shared, setShared] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [clearPassword, setClearPassword] = useState(false);
  const [expires, setExpires] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = saving || accessBusy;
  const internalLink = `${window.location.origin}/#/${file.kind === "doc" ? "document" : "preview"}/${file.id}`;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void Promise.all([sharesApi.get(file.id), fileAccessApi.access(file.id)])
      .then(([result, access]) => {
        if (!active) return;
        setCanManage(access.permission === "manage");
        setStatus(result);
        setAudience(result.audience ?? "anyone");
        setLinkPermission(result.permission ?? "read");
        setShared(result.visibility === "public");
        setExpires(localDate(result.expiresAt));
        setPassword("");
        setPasswordEnabled(result.hasPassword);
        setClearPassword(false);
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
    if (!status || busy) return;
    if (
      shared &&
      passwordEnabled &&
      ((!status.hasPassword && !password) || (password && password.length < 4))
    ) {
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
        audience,
        permission: linkPermission,
        expiresAt: shared && expires ? new Date(expires).toISOString() : null,
        ...(clearPassword ? { password: null } : password ? { password } : {}),
        ...(rotate ? { rotate: true } : {}),
      });
      setStatus(result);
      setPassword("");
      setPasswordEnabled(result.hasPassword);
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
  const copy = async () => {
    try {
      await copyText(shared && token ? shareLink(token) : internalLink);
      message.success(
        shared && token ? "已复制公开链接" : "已复制文档链接，访问仍需对应权限",
      );
    } catch {
      message.error("复制失败，请手动选择链接");
    }
  };
  const revoke = () =>
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
          setReload((value) => value + 1);
          await loadFiles();
          message.success("公开分享已撤销");
        } catch (error) {
          message.error(errorMessage(error));
          throw error;
        } finally {
          setSaving(false);
        }
      },
    });
  return (
    <Modal
      title="分享设置"
      open
      centered
      width={560}
      className={styles.dialog}
      onCancel={() => {
        if (!busy) close();
      }}
      closable={!busy}
      maskClosable={!busy}
      keyboard={!busy}
      footer={
        <div className={styles.footer}>
          <Button
            type="text"
            icon={<Copy size={15} />}
            onClick={() => void copy()}
          >
            {shared && token ? "复制公开链接" : "复制文档链接"}
          </Button>
          {tab === "link" && canManage ? (
            <Button
              type="primary"
              loading={saving}
              disabled={loading || Boolean(error) || accessBusy}
              onClick={() => void save()}
            >
              保存设置
            </Button>
          ) : (
            <Button disabled={busy} onClick={close}>
              完成
            </Button>
          )}
        </div>
      }
    >
      <div className={styles.file}>
        <FileIcon kind={file.kind} small />
        <span>{file.name}</span>
      </div>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        animated={false}
        items={[
          { key: "link", label: "链接分享" },
          ...(canManage
            ? [
                { key: "collaborators", label: "协作者" },
                {
                  key: "requests",
                  label: (
                    <span className={styles.tabLabel}>
                      访问申请
                      {requestCount > 0 && (
                        <span className={styles.count}>{requestCount}</span>
                      )}
                    </span>
                  ),
                },
              ]
            : []),
        ]}
      />
      <div className={styles.body}>
        {loading && (
          <div className={styles.empty}>
            <Spin size="small" />
          </div>
        )}
        {error && (
          <div role="alert" className={styles.empty}>
            {error}
            <Button
              size="small"
              onClick={() => setReload((value) => value + 1)}
            >
              重试
            </Button>
          </div>
        )}
        {status && !loading && !error && (
          <>
            <div hidden={tab !== "link"}>
              {canManage ? (
                <div className={styles.settings}>
                  <div className={styles.row}>
                    <label>访问范围</label>
                    <Select
                      aria-label="分享访问范围"
                      disabled={busy}
                      value={!shared ? "private" : audience}
                      options={[
                        { value: "private", label: "私有 · 成员和指定协作者" },
                        { value: "authenticated", label: "公开 · 登录用户" },
                        { value: "anyone", label: "公开 · 所有人" },
                      ]}
                      onChange={(
                        value: "private" | "authenticated" | "anyone",
                      ) => {
                        setShared(value !== "private");
                        if (value !== "private") setAudience(value);
                      }}
                    />
                  </div>
                  {shared && (
                    <>
                      <div className={styles.row}>
                        <label>登录用户权限</label>
                        <Select
                          aria-label="公开链接权限"
                          disabled={busy}
                          value={linkPermission}
                          options={[
                            { value: "read", label: "只读" },
                            { value: "edit", label: "可编辑" },
                          ]}
                          onChange={setLinkPermission}
                        />
                      </div>
                      {audience === "anyone" && (
                        <div className={styles.note}>未登录访客只能查看</div>
                      )}
                      <div className={styles.protection}>
                        <div className={styles.row}>
                          <label htmlFor="share-password-toggle">
                            密码保护
                          </label>
                          <Switch
                            id="share-password-toggle"
                            aria-label="密码保护"
                            size="small"
                            disabled={busy}
                            checked={passwordEnabled}
                            onChange={(enabled) => {
                              setPasswordEnabled(enabled);
                              setPassword("");
                              setClearPassword(!enabled && status.hasPassword);
                            }}
                          />
                        </div>
                        {passwordEnabled && (
                          <Input.Password
                            aria-label="分享密码"
                            value={password}
                            maxLength={128}
                            disabled={busy}
                            placeholder={
                              status.hasPassword
                                ? "已设置，留空保持原密码"
                                : "输入分享密码，至少4位"
                            }
                            onChange={(event) => {
                              setPassword(event.target.value);
                              setClearPassword(false);
                            }}
                          />
                        )}
                        <div className={styles.row}>
                          <label htmlFor="share-expiry-toggle">有效期</label>
                          <Switch
                            id="share-expiry-toggle"
                            aria-label="设置有效期"
                            size="small"
                            disabled={busy}
                            checked={Boolean(expires)}
                            onChange={(enabled) =>
                              setExpires(
                                enabled
                                  ? localDate(
                                      new Date(
                                        Date.now() + 86400000,
                                      ).toISOString(),
                                    )
                                  : "",
                              )
                            }
                          />
                        </div>
                        {expires && (
                          <input
                            aria-label="分享有效期"
                            type="datetime-local"
                            className={styles.date}
                            value={expires}
                            disabled={busy}
                            onChange={(event) => setExpires(event.target.value)}
                          />
                        )}
                      </div>
                    </>
                  )}
                  <div className={styles.linkBox}>
                    <div className={styles.linkHeading}>
                      <span>
                        {shared && token ? "公开分享链接" : "文档链接"}
                      </span>
                      {shared && status.enabled && (
                        <Button
                          type="text"
                          size="small"
                          disabled={busy}
                          icon={<RotateCw size={14} />}
                          onClick={rotate}
                        >
                          {token ? "更换链接" : "重新生成链接"}
                        </Button>
                      )}
                    </div>
                    <Input
                      aria-label={
                        shared && token ? "公开分享链接" : "文档内部链接"
                      }
                      readOnly
                      value={shared && token ? shareLink(token) : internalLink}
                    />
                    {shared && status.enabled && !token && (
                      <div className={styles.note}>
                        公开链接仅生成时展示，重新生成会使旧链接失效。
                      </div>
                    )}
                  </div>
                  {status.enabled && (
                    <Button
                      type="text"
                      danger
                      className={styles.revoke}
                      disabled={busy}
                      onClick={revoke}
                    >
                      撤销公开分享
                    </Button>
                  )}
                </div>
              ) : (
                <div className={styles.settings}>
                  <Input
                    aria-label="文档内部链接"
                    readOnly
                    value={internalLink}
                  />
                  <p className={styles.note}>
                    分享范围和协作者由文档创建者或空间负责人管理。
                  </p>
                </div>
              )}
            </div>
            {canManage && (
              <div hidden={tab === "link"}>
                <AccessManager
                  fileId={file.id}
                  view={tab === "requests" ? "requests" : "collaborators"}
                  onRequestCount={setRequestCount}
                  onBusyChange={setAccessBusy}
                />
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
