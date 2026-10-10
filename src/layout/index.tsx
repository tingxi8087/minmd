import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Dropdown, App, Input, Modal } from "antd";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronsUpDown,
  Clock3,
  FolderClosed,
  Home,
  Leaf,
  LogOut,
  Moon,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Star,
  Sun,
  Trash2,
  Users,
  X,
  Menu,
} from "lucide-react";
import { spaces, useWorkspace } from "@/store/workspace";
import styles from "./index.module.less";
export default function Layout() {
  const { space, setSpace, theme, setTheme, loggedIn, setLoggedIn } =
    useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const isDocument = location.pathname.startsWith("/document/");
  const { message } = App.useApp();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mobile, setMobile] = useState(false);
  useEffect(() => setMobile(false), [location.pathname, location.search]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const current = spaces.find((s) => s.id === space)!;
  const favoriteCount = useWorkspace(
    (s) =>
      s.files.filter((f) => f.space === space && f.favorite && !f.deleted)
        .length,
  );
  const files = useWorkspace((s) => s.files).filter(
    (f) =>
      f.space === space &&
      !f.deleted &&
      f.name.toLowerCase().includes(query.toLowerCase()),
  );
  const nav = [
    { to: "/files", icon: Home, label: "空间首页" },
    { to: "/recent", icon: Clock3, label: "最近访问" },
    { to: "/favorites", icon: Star, label: "我的收藏" },
    { to: "/shared", icon: ArrowUpRight, label: "公开分享" },
  ];
  if (!loggedIn) {
    return (
      <div className={styles.loggedOut}>
        <Leaf size={32} />
        <h2>登录后，回到你的空间</h2>
        <button className="primary-button" onClick={() => navigate("/login")}>
          进入演示登录
        </button>
      </div>
    );
  }
  return (
    <div className={styles.shell}>
      <aside className={`${styles.sidebar} ${mobile ? styles.mobileOpen : ""}`}>
        <div className={styles.brand}>
          <span className={styles.logo}>
            <span>m</span>
            <i />
          </span>
          <span>
            minmd<span className={styles.brandDot}>.</span>
          </span>
          <button
            className={`icon-button ${styles.closeMobile}`}
            aria-label="关闭导航"
            onClick={() => setMobile(false)}
          >
            <X size={18} />
          </button>
        </div>
        <Dropdown
          trigger={["click"]}
          menu={{
            selectedKeys: [space],
            items: spaces.map((s) => ({
              key: s.id,
              label: (
                <span>
                  {s.name}
                  <small className={styles.spaceOption}>{s.caption}</small>
                </span>
              ),
            })),
            onClick: ({ key }) => {
              setSpace(key);
              navigate("/files");
            },
          }}
        >
          <button className={styles.spaceSelect}>
            <span className={styles.spaceAvatar}>{current.initials}</span>
            <span>
              <strong>{current.name}</strong>
            </span>
            <ChevronsUpDown size={14} />
          </button>
        </Dropdown>
        <button
          className={styles.searchButton}
          onClick={() => setSearchOpen(true)}
        >
          <Search size={16} />
          <span>搜索空间</span>
          <kbd>⌘ K</kbd>
        </button>
        <nav className={styles.nav}>
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMobile(false)}
              className={({ isActive }) => (isActive ? styles.active : "")}
            >
              <Icon size={18} strokeWidth={1.7} />
              {label}
              {to === "/favorites" && (
                <span className={styles.navCount}>{favoriteCount}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className={styles.sideHeading}>
          空间文件夹{" "}
          <button
            className="icon-button"
            aria-label="新建文件夹"
            onClick={() => navigate("/files?new=folder")}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className={styles.folders}>
          {useWorkspace
            .getState()
            .files.filter(
              (f) => f.space === space && f.kind === "folder" && !f.deleted,
            )
            .map((f) => (
              <NavLink
                key={f.id}
                to={`/files?folder=${f.id}`}
                className={
                  location.search.includes(f.id) ? styles.folderActive : ""
                }
              >
                <FolderClosed size={17} strokeWidth={1.7} />
                {f.name}
              </NavLink>
            ))}
        </div>
        <div className={styles.sidebarBottom}>
          <div className={styles.sideDivider} />
          <nav className={styles.nav}>
            <NavLink to="/settings/members">
              <Users size={17} />
              空间成员<span className={styles.navCount}>{current.members}</span>
            </NavLink>
            <NavLink to="/settings/ai">
              <Sparkles size={17} />
              AI 接入
            </NavLink>
            <NavLink to="/trash">
              <Trash2 size={17} />
              回收站
            </NavLink>
            <NavLink to="/settings/general">
              <Settings2 size={17} />
              空间设置
            </NavLink>
          </nav>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                {
                  key: "theme",
                  label: theme === "light" ? "切换深色主题" : "切换浅色主题",
                  icon:
                    theme === "light" ? <Moon size={15} /> : <Sun size={15} />,
                },
                {
                  key: "logout",
                  label: "退出演示账号",
                  icon: <LogOut size={15} />,
                },
              ],
              onClick: ({ key }) => {
                if (key === "theme")
                  setTheme(theme === "light" ? "dark" : "light");
                else {
                  setLoggedIn(false);
                  message.info("已退出演示账号");
                  navigate("/login");
                }
              },
            }}
          >
            <button className={styles.profile}>
              <span className={styles.avatar}>T</span>
              <span>
                <strong>Tingxi</strong>
              </span>
              <ChevronDown size={14} />
            </button>
          </Dropdown>
        </div>
      </aside>
      <div className={styles.main}>
        <header
          className={`${styles.topbar} ${isDocument ? styles.documentTopbar : ""}`}
        >
          <div className={styles.breadcrumb}>
            <button
              className={`icon-button ${styles.mobileToggle}`}
              onClick={() => setMobile(true)}
              aria-label="打开导航"
            >
              <Menu size={20} />
            </button>
            {!isDocument && <strong>{current.name}</strong>}
          </div>
          {isDocument && (
            <div id="document-header" className={styles.documentHost} />
          )}
          <div className={styles.headerActions}>
            <button
              className="icon-button"
              aria-label="切换主题"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {!isDocument && <span className={styles.avatar}>T</span>}
          </div>
        </header>
        <Outlet />
      </div>
      <Modal
        title="搜索空间"
        open={searchOpen}
        onCancel={() => setSearchOpen(false)}
        footer={null}
      >
        <Input
          autoFocus
          prefix={<Search size={16} />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索文件与文件夹…"
          size="large"
        />
        <div className={styles.searchResults}>
          {files.slice(0, 8).map((f) => (
            <button
              key={f.id}
              onClick={() => {
                navigate(
                  f.kind === "folder"
                    ? `/files?folder=${f.id}`
                    : `/preview/${f.id}`,
                );
                setSearchOpen(false);
              }}
            >
              <FolderClosed size={16} />
              {f.name}
              <ArrowUpRight size={14} />
            </button>
          ))}
          {!files.length && <p>没有找到匹配的文件</p>}
        </div>
      </Modal>
    </div>
  );
}
