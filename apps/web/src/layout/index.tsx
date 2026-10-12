import { useEffect, useRef, useState, type CSSProperties } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Dropdown, App, Input, Modal, Tooltip } from "antd";
import {
  ArrowUpRight,
  ChevronsUpDown,
  Clock3,
  FolderClosed,
  Home,
  LogOut,
  Moon,
  Search,
  Settings2,
  Sparkles,
  Star,
  Sun,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { useWorkspace } from "@/store/workspace";
import { useAuth } from "@/store/auth";
import { spaceApi } from "@/api/spaces";
import { errorMessage } from "@/http";
import TooltipButton from "@/components/TooltipButton";
import BrandIcon from "@/components/BrandIcon";
import { useLayout, SIDEBAR_MIN, SIDEBAR_MAX } from "@/store/layout";
import WorkspaceTree from "./components/WorkspaceTree";
import styles from "./index.module.less";
import { memberReturnPath } from "@/utils/memberReturn";
export default function Layout() {
  const { space, spaces, setSpace, theme, setTheme, loadSpaces } =
    useWorkspace();
  const { user, status, bootstrap, logout } = useAuth();
  const [spaceName, setSpaceName] = useState("");
  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
  const [creatingSpace, setCreatingSpace] = useState(false);
  useEffect(() => {
    if (status === "idle") void bootstrap();
  }, [status, bootstrap]);
  const returnSpace = useRef(space);
  if (space) returnSpace.current = space;
  useEffect(() => {
    if (status === "anonymous")
      navigate("/login", {
        replace: true,
        state: {
          returnTo: memberReturnPath(`${location.pathname}${location.search}`),
          returnSpace: returnSpace.current,
        },
      });
  }, [status]);
  const { sidebarWidth, sidebarCollapsed, setSidebarWidth, toggleSidebar } =
    useLayout();
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 680px)").matches,
  );
  const [resizing, setResizing] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const dragStart = useRef({ x: 0, width: sidebarWidth });
  useEffect(() => {
    const query = window.matchMedia("(max-width: 680px)");
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const navigate = useNavigate();
  const location = useLocation();
  const isDocument =
    location.pathname.startsWith("/document/") ||
    location.pathname.startsWith("/preview/");
  const { message } = App.useApp();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (sidebarRef.current)
      sidebarRef.current.inert = narrow ? !mobile : sidebarCollapsed;
  }, [narrow, mobile, sidebarCollapsed]);
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
  const current = spaces.find((s) => s.id === space);
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
  if (status !== "authenticated") {
    return <div className={styles.loggedOut}>正在连接空间…</div>;
  }

  return (
    <div
      className={`${styles.shell} ${sidebarCollapsed ? styles.collapsed : ""} ${resizing ? styles.resizing : ""}`}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <aside
        ref={sidebarRef}
        aria-hidden={narrow ? !mobile : sidebarCollapsed}
        className={`${styles.sidebar} ${mobile ? styles.mobileOpen : ""}`}
      >
        <div className={styles.brand}>
          <BrandIcon size={29} className={styles.logo} />
          <span>minmd</span>
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
            items: [
              ...spaces.map((s) => ({ key: s.id, label: s.name })),
              { type: "divider" as const },
              { key: "create-space", label: "新建空间" },
            ],
            onClick: ({ key }) => {
              if (key === "create-space") {
                setCreateSpaceOpen(true);
                return;
              }
              void setSpace(key).catch((error: unknown) =>
                message.error(errorMessage(error)),
              );
              navigate("/files");
            },
          }}
        >
          <button className={styles.spaceSelect}>
            <span className={styles.spaceAvatar}>
              {current?.name.slice(0, 1) ?? "+"}
            </span>
            <span>
              <strong>{current?.name ?? "创建空间"}</strong>
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
            <Tooltip
              key={to}
              title={
                to === "/favorites" ? `${label}（${favoriteCount}）` : label
              }
              trigger={["hover", "focus"]}
              mouseEnterDelay={0.1}
              mouseLeaveDelay={0.05}
              color="var(--text)"
              styles={{
                body: { color: "var(--bg)", fontSize: 12, padding: "4px 8px" },
              }}
            >
              <NavLink
                to={to}
                aria-label={label}
                onClick={() => setMobile(false)}
                className={({ isActive }) => (isActive ? styles.active : "")}
              >
                <Icon size={18} strokeWidth={1.7} />
              </NavLink>
            </Tooltip>
          ))}
        </nav>
        <WorkspaceTree />
        <div className={styles.sidebarBottom}>
          <div className={styles.sideDivider} />
          <div className={styles.bottomActions}>
            {[
              { to: "/settings/ai", name: "AI 接入", icon: Sparkles },
              { to: "/trash", name: "回收站", icon: Trash2 },
              {
                to: "/settings/general",
                name: "空间设置与成员",
                icon: Settings2,
              },
            ].map(({ to, name, icon: Icon }) => (
              <TooltipButton
                key={to}
                aria-label={name}
                className={`icon-button ${location.pathname === to || (to === "/settings/general" && location.pathname === "/settings/members") ? styles.bottomActive : ""}`}
                onClick={() => navigate(to)}
              >
                <Icon size={15} />
              </TooltipButton>
            ))}
          </div>
        </div>
      </aside>
      <div
        className={styles.resizeHandle}
        role="separator"
        aria-label="调整导航宽度"
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        aria-valuenow={sidebarWidth}
        tabIndex={sidebarCollapsed || narrow ? -1 : 0}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          dragStart.current = { x: e.clientX, width: sidebarWidth };
          e.currentTarget.setPointerCapture(e.pointerId);
          setResizing(true);
          e.preventDefault();
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            setSidebarWidth(
              dragStart.current.width + e.clientX - dragStart.current.x,
            );
        }}
        onPointerUp={() => setResizing(false)}
        onPointerCancel={() => setResizing(false)}
        onLostPointerCapture={() => setResizing(false)}
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            return;
          e.preventDefault();
          setSidebarWidth(
            e.key === "Home"
              ? SIDEBAR_MIN
              : e.key === "End"
                ? SIDEBAR_MAX
                : sidebarWidth + (e.key === "ArrowRight" ? 10 : -10),
          );
        }}
      />
      <div className={styles.main}>
        <header
          className={`${styles.topbar} ${isDocument ? styles.documentTopbar : ""}`}
        >
          <div className={styles.breadcrumb}>
            <TooltipButton
              className="icon-button"
              onClick={() =>
                narrow ? setMobile((value) => !value) : toggleSidebar()
              }
              aria-label={
                narrow ? "打开导航" : sidebarCollapsed ? "展开导航" : "收起导航"
              }
              aria-expanded={narrow ? mobile : !sidebarCollapsed}
            >
              {!narrow && !sidebarCollapsed ? (
                <PanelLeftClose size={18} />
              ) : (
                <PanelLeftOpen size={18} />
              )}
            </TooltipButton>
            {!isDocument && <strong>{current?.name ?? "创建空间"}</strong>}
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
            <Dropdown
              trigger={["click"]}
              placement="bottomRight"
              menu={{
                items: [
                  {
                    key: "account",
                    label: user?.nickname || user?.account,
                    disabled: true,
                  },
                  { type: "divider" },
                  {
                    key: "theme",
                    label: theme === "light" ? "切换深色主题" : "切换浅色主题",
                    icon:
                      theme === "light" ? (
                        <Moon size={15} />
                      ) : (
                        <Sun size={15} />
                      ),
                  },
                  {
                    key: "logout",
                    label: "退出账号",
                    icon: <LogOut size={15} />,
                  },
                ],
                onClick: async ({ key }) => {
                  if (key === "theme")
                    setTheme(theme === "light" ? "dark" : "light");
                  else {
                    try {
                      await logout();
                      navigate("/login", { replace: true });
                    } catch (error) {
                      message.error(errorMessage(error));
                    }
                  }
                },
              }}
            >
              <TooltipButton
                className={styles.accountButton}
                aria-label="账号菜单"
              >
                <span className={styles.avatar} aria-hidden="true">
                  {(user?.nickname || user?.account || "")
                    .slice(0, 1)
                    .toUpperCase()}
                </span>
              </TooltipButton>
            </Dropdown>
          </div>
        </header>
        {current ? (
          <Outlet />
        ) : (
          <div className={styles.loggedOut}>
            <h2>创建你的第一个空间</h2>
            <button
              className="primary-button"
              onClick={() => setCreateSpaceOpen(true)}
            >
              新建空间
            </button>
          </div>
        )}
      </div>
      <Modal
        title="新建空间"
        open={createSpaceOpen}
        onCancel={() => setCreateSpaceOpen(false)}
        confirmLoading={creatingSpace}
        okText="创建"
        cancelText="取消"
        onOk={async () => {
          if (!spaceName.trim()) {
            message.warning("请输入空间名称");
            return;
          }
          setCreatingSpace(true);
          try {
            const created = await spaceApi.create(spaceName.trim());
            await loadSpaces();
            await setSpace(created.id);
            setSpaceName("");
            setCreateSpaceOpen(false);
            navigate("/files");
          } catch (error) {
            message.error(errorMessage(error));
          } finally {
            setCreatingSpace(false);
          }
        }}
      >
        <Input
          aria-label="空间名称"
          value={spaceName}
          onChange={(event) => setSpaceName(event.target.value)}
          maxLength={80}
          placeholder="空间名称"
        />
      </Modal>
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
