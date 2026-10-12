import { useWorkspace } from "@/store/workspace";
import { useEffect, useState } from "react";
import { App, Button, Select, Spin } from "antd";
import { UserPlus, Users, X } from "lucide-react";
import {
  notifyFileAccessChanged,
  fileAccessApi,
  type AccessSettings,
  type Collaborator,
  type Permission,
} from "@/api/fileAccess";
import { errorMessage } from "@/http";
import styles from "./index.module.less";
const permissions = [
  { value: "read", label: "只读" },
  { value: "edit", label: "可编辑" },
];
export default function AccessManager({
  fileId,
  view,
  onRequestCount,
  onBusyChange,
}: {
  fileId: string;
  view: "collaborators" | "requests";
  onRequestCount: (count: number) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<AccessSettings | null>(null),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false);
  const [approvals, setApprovals] = useState<Record<string, Permission>>({});
  useEffect(() => {
    onRequestCount(settings?.requests.length ?? 0);
  }, [settings, onRequestCount]);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  const [query, setQuery] = useState(""),
    [users, setUsers] = useState<Collaborator[]>([]);
  const [userId, setUserId] = useState<string>(),
    [permission, setPermission] = useState<Permission>("read");
  useEffect(() => {
    let active = true;
    setError("");
    void fileAccessApi
      .settings(fileId)
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch((error: unknown) => {
        if (active) setError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [fileId, revision]);
  useEffect(() => {
    let active = true;
    if (query.trim().length < 2) {
      setUsers([]);
      return;
    }
    const timer = setTimeout(() => {
      void fileAccessApi
        .search(query.trim())
        .then((value) => {
          if (active) setUsers(value);
        })
        .catch((error: unknown) => {
          if (active) message.error(errorMessage(error));
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);
  const mutate = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await operation();
      await useWorkspace.getState().loadFiles();
      notifyFileAccessChanged(fileId);
      setRevision((value) => value + 1);
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  if (error)
    return (
      <div role="alert" className={styles.error}>
        {error}
        <Button size="small" onClick={() => setRevision((value) => value + 1)}>
          重试
        </Button>
      </div>
    );
  if (!settings) return <Spin size="small" />;
  return (
    <div className={styles.manager}>
      {view === "collaborators" && (
        <>
          <div className={styles.row}>
            <span>空间成员默认权限</span>
            <Select
              aria-label="空间成员默认权限"
              disabled={busy}
              value={settings.memberPermission}
              options={permissions}
              onChange={(value) =>
                void mutate(() => fileAccessApi.memberPermission(fileId, value))
              }
            />
          </div>
          <div className={styles.section}>
            <strong>指定协作者</strong>
            <div className={styles.add}>
              <Select
                showSearch
                aria-label="搜索协作者"
                placeholder="搜索账号或昵称"
                value={userId}
                filterOption={false}
                onSearch={setQuery}
                onChange={setUserId}
                options={users.map((user) => ({
                  value: user.id,
                  label: `${user.nickname || user.account} · ${user.account}`,
                }))}
                disabled={busy}
                notFoundContent={
                  query.trim().length < 2 ? "输入至少两个字符" : "没有找到用户"
                }
              />
              <Select
                aria-label="新增协作者权限"
                value={permission}
                options={permissions}
                onChange={setPermission}
                disabled={busy}
              />
              <Button
                aria-label="添加协作者"
                icon={<UserPlus size={15} />}
                disabled={!userId || busy}
                onClick={() =>
                  void mutate(async () => {
                    await fileAccessApi.grant(fileId, userId!, permission);
                    setUserId(undefined);
                    setQuery("");
                  })
                }
              />
            </div>
            {!settings.grants.length && (
              <div className={styles.empty}>尚未添加指定协作者</div>
            )}
            {settings.grants.map((grant) => (
              <div className={styles.row} key={grant.user.id}>
                <div className={styles.person}>
                  <span className={styles.avatar}>
                    {(grant.user.nickname || grant.user.account)
                      .slice(0, 1)
                      .toUpperCase()}
                  </span>
                  <div className={styles.identity}>
                    <span>{grant.user.nickname || grant.user.account}</span>
                    {grant.user.nickname &&
                      grant.user.nickname !== grant.user.account && (
                        <span className={styles.account}>
                          {grant.user.account}
                        </span>
                      )}
                  </div>
                </div>
                <div className={styles.controls}>
                  <Select
                    aria-label={`${grant.user.account}的权限`}
                    value={grant.permission}
                    options={permissions}
                    disabled={busy}
                    onChange={(value) =>
                      void mutate(() =>
                        fileAccessApi.grant(fileId, grant.user.id, value),
                      )
                    }
                  />
                  <Button
                    type="text"
                    aria-label={`移除${grant.user.account}`}
                    icon={<X size={14} />}
                    disabled={busy}
                    onClick={() =>
                      void mutate(() =>
                        fileAccessApi.removeGrant(fileId, grant.user.id),
                      )
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {view === "requests" && (
        <div className={styles.requests}>
          {!settings.requests.length && (
            <div className={styles.empty}>
              <Users size={24} strokeWidth={1.5} />
              <span>暂无待处理申请</span>
            </div>
          )}
          {settings.requests.map((item) => (
            <div key={item.id} className={styles.application}>
              <div className={styles.person}>
                <span className={styles.avatar}>
                  {(item.user.nickname || item.user.account)
                    .slice(0, 1)
                    .toUpperCase()}
                </span>
                <div className={styles.identity}>
                  <span>{item.user.nickname || item.user.account}</span>
                  <span className={styles.account}>
                    申请{item.permission === "edit" ? "编辑" : "访问"}权限
                  </span>
                </div>
              </div>
              {item.reason && <p>{item.reason}</p>}
              <div className={styles.controls}>
                <Select
                  aria-label={`${item.user.account}的批准权限`}
                  disabled={busy}
                  value={approvals[item.id] ?? item.permission}
                  options={permissions}
                  onChange={(value: Permission) =>
                    setApprovals((current) => ({
                      ...current,
                      [item.id]: value,
                    }))
                  }
                />
                <Button
                  type="primary"
                  disabled={busy}
                  onClick={() =>
                    void mutate(() =>
                      fileAccessApi.decide(
                        fileId,
                        item.id,
                        "approve",
                        approvals[item.id] ?? item.permission,
                      ),
                    )
                  }
                >
                  批准
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void mutate(() =>
                      fileAccessApi.decide(fileId, item.id, "reject"),
                    )
                  }
                >
                  拒绝
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
