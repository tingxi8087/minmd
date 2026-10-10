import { useState } from "react";
import { useParams, NavLink } from "react-router-dom";
import { App, Input, Modal, Select } from "antd";
import {
  ArrowUpRight,
  Check,
  Copy,
  KeyRound,
  Moon,
  Plus,
  Sun,
  Trash2,
  Users,
} from "lucide-react";
import { spaces, useWorkspace } from "@/store/workspace";
import styles from "./index.module.less";
const members = [
  {
    name: "Tingxi",
    initials: "T",
    email: "tingxi@example.com",
    role: "所有者",
    status: "你",
  },
  {
    name: "林小满",
    initials: "L",
    email: "xiaoman@example.com",
    role: "编辑者",
    status: "",
  },
  {
    name: "陈一",
    initials: "C",
    email: "chenyi@example.com",
    role: "编辑者",
    status: "",
  },
  {
    name: "周可",
    initials: "Z",
    email: "zhouke@example.com",
    role: "查看者",
    status: "",
  },
];
export default function Settings() {
  const { section } = useParams();
  const { space, theme, setTheme, keys, addKey, removeKey, reset } =
    useWorkspace();
  const current = spaces.find((s) => s.id === space)!;
  const { message, modal } = App.useApp();
  const [keyOpen, setKeyOpen] = useState(false);
  const [name, setName] = useState("");
  const [access, setAccess] = useState<"read" | "write">("read");
  const [secret, setSecret] = useState("");
  const [tab, setTab] = useState<"mcp" | "api">("mcp");
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success("已复制");
    } catch {
      message.error("复制失败，请手动选择文本");
    }
  };
  const config =
    tab === "mcp"
      ? JSON.stringify(
          {
            mcpServers: {
              minmd: {
                url: "https://your-minmd.example/mcp",
                headers: { Authorization: "Bearer <YOUR_API_KEY>" },
              },
            },
          },
          null,
          2,
        )
      : "GET https://your-minmd.example/api/v1/spaces/<SPACE_ID>/files\nAuthorization: Bearer <YOUR_API_KEY>";
  const createKey = () => {
    if (!name.trim()) {
      message.warning("请输入密钥名称");
      return;
    }
    const key = "demo_minmd_" + crypto.randomUUID().replaceAll("-", "");
    addKey({
      id: crypto.randomUUID(),
      name: name.trim(),
      prefix: key.slice(0, 17) + "…",
      space,
      access,
      created: "刚刚",
    });
    setSecret(key);
    setKeyOpen(false);
    setName("");
  };
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
            <div>
              <h2>
                空间成员 <small>{current.members}</small>
              </h2>
            </div>
            <button
              className="secondary-button"
              onClick={() =>
                modal.info({
                  title: "成员管理",
                  content:
                    "此处展示空间成员。账号管理将复用 MAS 后台；空间成员分配功能在后端接入时实现。",
                  okText: "知道了",
                })
              }
            >
              <Users size={15} />
              管理成员
            </button>
          </div>
          <div className={styles.members}>
            <div className={styles.memberHead}>
              <span>成员</span>
              <span>空间角色</span>
            </div>
            {(space === "personal" ? members.slice(0, 1) : members).map(
              (m, i) => (
                <div key={m.email} className={styles.member}>
                  <span className={styles.memberAvatar} data-index={i}>
                    {m.initials}
                  </span>
                  <div>
                    <strong>
                      {m.name}{" "}
                      {m.status && <span className="badge">{m.status}</span>}
                    </strong>
                    <small>{m.email}</small>
                  </div>
                  <span>{m.role}</span>
                </div>
              ),
            )}
          </div>
        </>
      ) : section === "ai" ? (
        <>
          <div className={styles.sectionTop}>
            <div>
              <h2>API 密钥</h2>
              <p>演示密钥与配置，API / MCP 尚未接入。</p>
            </div>
            <button className="primary-button" onClick={() => setKeyOpen(true)}>
              <Plus size={15} />
              创建密钥
            </button>
          </div>
          <div className={styles.keyList}>
            {keys.filter((k) => k.space === space).length ? (
              keys
                .filter((k) => k.space === space)
                .map((k) => (
                  <div className={styles.keyRow} key={k.id}>
                    <KeyRound size={18} />
                    <div>
                      <strong>{k.name}</strong>
                      <code>{k.prefix}</code>
                    </div>
                    <span className="badge">
                      {k.access === "read" ? "只读" : "读写"}
                    </span>
                    <button
                      className="icon-button"
                      aria-label={`撤销密钥 ${k.name}`}
                      onClick={() =>
                        modal.confirm({
                          title: "撤销这个演示密钥？",
                          content: k.name,
                          okText: "撤销",
                          cancelText: "取消",
                          onOk: () => removeKey(k.id),
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
            ) : (
              <div className={styles.keyEmpty}>
                <KeyRound size={25} strokeWidth={1.3} />
                <strong>还没有 API 密钥</strong>
              </div>
            )}
          </div>
          <div className={styles.sectionTop}>
            <div>
              <h2>连接你的工具</h2>
              <p>复制配置模板，替换部署地址和密钥后使用。</p>
            </div>
          </div>
          <div className={styles.codePanel}>
            <div className={styles.codeTabs}>
              <button
                className={tab === "mcp" ? styles.codeActive : ""}
                onClick={() => setTab("mcp")}
              >
                MCP 配置
              </button>
              <button
                className={tab === "api" ? styles.codeActive : ""}
                onClick={() => setTab("api")}
              >
                HTTP API
              </button>
              <button onClick={() => void copy(config)}>
                <Copy size={14} />
                复制
              </button>
            </div>
            <pre>{config}</pre>
          </div>
        </>
      ) : (
        <>
          <div className={styles.settingRow}>
            <div>
              <strong>数据存储</strong>
              <p>文件与修改保存在当前浏览器，尚未接入后端。</p>
            </div>
          </div>
          <div className={styles.sectionTop}>
            <div>
              <h2>空间信息</h2>
            </div>
          </div>
          <div className={styles.settingRow}>
            <div>
              <strong>空间名称</strong>
              <p>{current.name}</p>
            </div>
            <span className="badge">{current.caption}</span>
          </div>
          <div className={styles.settingRow}>
            <div>
              <strong>后台管理</strong>
              <p>待接入 MAS 管理后台。</p>
            </div>
            <button
              className="secondary-button"
              onClick={() =>
                modal.info({
                  title: "管理后台待接入",
                  content:
                    "这一版只实现 MinMD 前台。后续沿用 mas-backend-cli 的管理后台，不额外重做账号与权限页面。",
                  okText: "知道了",
                })
              }
            >
              管理入口 <ArrowUpRight size={14} />
            </button>
          </div>
          <div className={styles.sectionTop}>
            <div>
              <h2>外观</h2>
            </div>
          </div>
          <div className={styles.themes}>
            {(["light", "dark"] as const).map((t) => (
              <button
                key={t}
                className={`${styles.themeCard} ${theme === t ? styles.themeSelected : ""}`}
                onClick={() => setTheme(t)}
              >
                <div className={styles.themePreview} data-theme={t}>
                  <aside />
                  <div>
                    <i />
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
                <span>
                  {t === "light" ? <Sun size={15} /> : <Moon size={15} />}{" "}
                  {t === "light" ? "晴日 · 浅色" : "夜读 · 深色"}
                  {theme === t && <Check size={15} />}
                </span>
              </button>
            ))}
          </div>
          <div className={styles.settingRow}>
            <div>
              <strong>重置演示数据</strong>
              <p>清除本地文件修改与演示密钥，恢复初始样例。</p>
            </div>
            <button
              className="secondary-button"
              onClick={() =>
                modal.confirm({
                  title: "重置本地演示？",
                  content: "本地新建文件和修改将被清除。",
                  okText: "重置",
                  cancelText: "取消",
                  onOk: () => {
                    reset();
                    message.success("已恢复初始演示数据");
                  },
                })
              }
            >
              重置
            </button>
          </div>
        </>
      )}
      <Modal
        title="创建演示密钥"
        open={keyOpen}
        onCancel={() => setKeyOpen(false)}
        onOk={createKey}
        okText="创建"
        cancelText="取消"
      >
        <div className="field">
          <label>密钥名称</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：我的 AI 助手"
            maxLength={64}
          />
        </div>
        <div className="field">
          <label>绑定空间</label>
          <Input value={current.name} disabled />
        </div>
        <div className="field">
          <label>访问权限</label>
          <Select
            value={access}
            onChange={setAccess}
            options={[
              { value: "read", label: "只读 · 读取内容" },
              { value: "write", label: "读写 · 读取并修改内容" },
            ]}
          />
        </div>
        <p className="dialog-note">
          仅演示交互，生成的密钥无法调用 API 或 MCP。
        </p>
      </Modal>
      <Modal
        title="演示密钥已创建"
        open={!!secret}
        onCancel={() => setSecret("")}
        footer={
          <button className="primary-button" onClick={() => setSecret("")}>
            我已保存
          </button>
        }
      >
        <p className="dialog-note">
          完整值仅在此窗口显示。当前密钥为演示值，不具备访问能力。
        </p>
        <div className={styles.secret}>
          <code>{secret}</code>
          <button
            className="icon-button"
            aria-label="复制演示密钥"
            onClick={() => void copy(secret)}
          >
            <Copy size={15} />
          </button>
        </div>
      </Modal>
    </main>
  );
}
