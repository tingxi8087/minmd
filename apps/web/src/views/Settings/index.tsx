import { useEffect, useState, useRef } from "react";
import { NavLink, useParams } from "react-router-dom";
import { App, Input, Modal } from "antd";
import { Check, Moon, Plus, Sun, Trash2, ArrowRightLeft } from "lucide-react";
import { useWorkspace } from "@/store/workspace";
import { useAuth } from "@/store/auth";
import { spaceApi, type SpaceMember } from "@/api/spaces";
import { errorMessage } from "@/http";
import { useScopedTasks, type ScopedTask } from "@/utils/useScopedTask";
import styles from "./index.module.less";
import AiSettings from "./components/AiSettings";
export default function Settings() {
  const { section } = useParams();
  const { space, spaces, theme, setTheme, loadSpaces } = useWorkspace();
  const user = useAuth((state) => state.user);
  const current = spaces.find((item) => item.id === space);
  const owner = current?.ownerId === user?.id;
  const { message, modal } = App.useApp();
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [memberTotal, setMemberTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState("");
  const begin = useScopedTasks();
  const memberRequest = useRef(0);
  const assertHere = () => {
    if (
      useAuth.getState().user !== user ||
      useWorkspace.getState().space !== space
    )
      throw new DOMException("空间或身份已切换", "AbortError");
  };
  const refreshMembers = async (existing?: ScopedTask) => {
    assertHere();
    const own = existing ? undefined : begin();
    const task = existing ?? own!;
    const requestId = ++memberRequest.current;
    setLoading(true);
    setFailure("");
    try {
      const result = await task.wait(() =>
        spaceApi.members(space, page, task.signal),
      );
      if (requestId !== memberRequest.current) return;
      setMembers(result.items);
      setMemberTotal(result.total);
    } catch (error) {
      if (!task.signal.aborted && requestId === memberRequest.current)
        setFailure(errorMessage(error));
    } finally {
      own?.finish();
      if (!task.signal.aborted && requestId === memberRequest.current)
        setLoading(false);
    }
  };
  useEffect(() => {
    setPage(1);
    setMembers([]);
    setMemberTotal(0);
    setFailure("");
    setAddOpen(false);
    setRenameOpen(false);
    setAccount("");
    setBusy(false);
  }, [space, user]);
  useEffect(() => {
    if (section !== "members" || !space) return;
    const task = begin();
    void refreshMembers(task);
    return () => {
      task.controller.abort();
      task.finish();
    };
  }, [space, user, section, page]);
  if (!current) return null;
  return (
    <main className={styles.page}>
      <h1>空间设置</h1>
      <div className={styles.tabs}>
        <NavLink to="/settings/general">通用设置</NavLink>
        <NavLink to="/settings/members">空间成员</NavLink>
        <NavLink to="/settings/ai">AI 接入</NavLink>
      </div>
      {section === "members" ? (
        <>
          <div className={styles.sectionTop}>
            <h2>
              空间成员 <small>{memberTotal}</small>
            </h2>
            {owner && (
              <button
                className="secondary-button"
                onClick={() => setAddOpen(true)}
              >
                <Plus size={15} />
                添加成员
              </button>
            )}
          </div>
          {failure && (
            <p role="alert">
              {failure}{" "}
              <button
                className="secondary-button"
                onClick={() => void refreshMembers()}
              >
                重试
              </button>
            </p>
          )}
          {loading && <p role="status">正在加载成员…</p>}
          <div className={styles.members}>
            <div className={styles.memberHead}>
              <span>成员</span>
              <span>空间角色</span>
            </div>
            {members.map((member) => (
              <div className={styles.member} key={member.id}>
                <span className={styles.memberAvatar}>
                  {(member.nickname || member.account)
                    .slice(0, 1)
                    .toUpperCase()}
                </span>
                <div>
                  <strong>
                    {member.nickname || member.account}
                    {member.id === user?.id && (
                      <span className="badge">你</span>
                    )}
                  </strong>
                  <small>{member.account}</small>
                </div>
                <span>{member.role === "owner" ? "负责人" : "成员"}</span>
                {owner && member.role !== "owner" && (
                  <>
                    <button
                      className="icon-button"
                      aria-label={`转移负责人给 ${member.account}`}
                      onClick={() =>
                        modal.confirm({
                          title: "转移空间负责人？",
                          content: `将空间交给 ${member.nickname || member.account}，你的身份将变为成员。`,
                          okText: "转移",
                          cancelText: "取消",
                          onOk: async () => {
                            const task = begin();
                            try {
                              assertHere();
                              await task.wait(() =>
                                spaceApi.transfer(
                                  space,
                                  member.id,
                                  task.signal,
                                ),
                              );
                              await task.wait(() => loadSpaces());
                              await refreshMembers(task);
                            } catch (error) {
                              if (!task.signal.aborted) {
                                message.error(errorMessage(error));
                                throw error;
                              }
                            } finally {
                              task.finish();
                            }
                          },
                        })
                      }
                    >
                      <ArrowRightLeft size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`移除成员 ${member.account}`}
                      onClick={() =>
                        modal.confirm({
                          title: "移除空间成员？",
                          content: member.nickname || member.account,
                          okText: "移除",
                          cancelText: "取消",
                          onOk: async () => {
                            const task = begin();
                            try {
                              assertHere();
                              await task.wait(() =>
                                spaceApi.removeMember(
                                  space,
                                  member.id,
                                  task.signal,
                                ),
                              );
                              await refreshMembers(task);
                            } catch (error) {
                              if (!task.signal.aborted) {
                                message.error(errorMessage(error));
                                throw error;
                              }
                            } finally {
                              task.finish();
                            }
                          },
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          {memberTotal > 100 && (
            <div className={styles.sectionTop}>
              <button
                className="secondary-button"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </button>
              <span>第 {page} 页</span>
              <button
                className="secondary-button"
                disabled={page * 100 >= memberTotal}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </>
      ) : section === "ai" ? (
        <AiSettings key={space} spaceId={space} owner={owner} />
      ) : (
        <>
          <div className={styles.sectionTop}>
            <h2>空间信息</h2>
          </div>
          <div className={styles.settingRow}>
            <div>
              <strong>空间名称</strong>
              <p>{current.name}</p>
            </div>
            {owner && (
              <button
                className="secondary-button"
                onClick={() => {
                  setName(current.name);
                  setRenameOpen(true);
                }}
              >
                修改名称
              </button>
            )}
          </div>
          <div className={styles.settingRow}>
            <div>
              <strong>当前账号</strong>
              <p>{user?.nickname || user?.account}</p>
            </div>
            <span className="badge">{owner ? "负责人" : "成员"}</span>
          </div>
          <div className={styles.sectionTop}>
            <h2>外观</h2>
          </div>
          <div className={styles.themes}>
            {(["light", "dark"] as const).map((value) => (
              <button
                key={value}
                className={`${styles.themeCard} ${theme === value ? styles.themeSelected : ""}`}
                onClick={() => setTheme(value)}
              >
                <div className={styles.themePreview} data-theme={value}>
                  <aside />
                  <div>
                    <i />
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
                <span>
                  {value === "light" ? <Sun size={15} /> : <Moon size={15} />}
                  {value === "light" ? "晴日 · 浅色" : "夜读 · 深色"}
                  {theme === value && <Check size={15} />}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      <Modal
        title="添加空间成员"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        confirmLoading={busy}
        okText="添加"
        cancelText="取消"
        onOk={async () => {
          if (!account.trim()) {
            message.warning("请输入现有账号");
            return;
          }
          setBusy(true);
          const task = begin();
          try {
            assertHere();
            const result = await task.wait(() =>
              spaceApi.accounts(space, account.trim(), task.signal),
            );
            const match = result.items.find(
              (item) =>
                item.account.toLowerCase() === account.trim().toLowerCase(),
            );
            if (!match) throw new Error("未找到该账号，请先在管理后台创建账号");
            await task.wait(() =>
              spaceApi.addMember(space, match.id, task.signal),
            );
            await refreshMembers(task);
            task.assertActive();
            setAccount("");
            setAddOpen(false);
          } catch (error) {
            if (!task.signal.aborted) message.error(errorMessage(error));
          } finally {
            task.finish();
            if (!task.signal.aborted) setBusy(false);
          }
        }}
      >
        <Input
          aria-label="成员账号"
          value={account}
          onChange={(event) => setAccount(event.target.value)}
          placeholder="输入现有账号"
          maxLength={64}
        />
      </Modal>
      <Modal
        title="修改空间名称"
        open={renameOpen}
        onCancel={() => setRenameOpen(false)}
        okText="保存"
        cancelText="取消"
        confirmLoading={busy}
        onOk={async () => {
          if (!name.trim()) {
            message.warning("请输入空间名称");
            return;
          }
          setBusy(true);
          const task = begin();
          try {
            assertHere();
            await task.wait(() =>
              spaceApi.update(space, name.trim(), task.signal),
            );
            await task.wait(() => loadSpaces());
            setRenameOpen(false);
          } catch (error) {
            if (!task.signal.aborted) message.error(errorMessage(error));
          } finally {
            task.finish();
            if (!task.signal.aborted) setBusy(false);
          }
        }}
      >
        <Input
          aria-label="新的空间名称"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
        />
      </Modal>
    </main>
  );
}
