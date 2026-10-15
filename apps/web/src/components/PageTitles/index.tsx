import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/store/auth";
import { useWorkspace } from "@/store/workspace";

type TitleEntry = { id: symbol; scope: string; text: string; priority: number };
type Register = (id: symbol, text: string, priority: number) => () => void;
const TitleContext = createContext<Register | null>(null);
const labels: Record<string, string> = {
  "/login": "登录",
  "/setup": "创建你的空间",
  "/recent": "最近访问",
  "/favorites": "收藏",
  "/shared": "公开分享",
  "/trash": "回收站",
  "/shared-with-me": "与我共享",
  "/notifications": "通知",
  "/settings/general": "通用设置",
  "/settings/members": "空间成员",
  "/settings/ai": "AI 接入",
};
export function routeTitle(path: string, spaceName?: string) {
  if (/^\/(document|preview)\//.test(path)) return "正在打开文件";
  if (path.startsWith("/share/")) return "公开分享";
  if (path === "/login" || path === "/setup" || path === "/notifications")
    return labels[path];
  if (path === "/" || path === "/files") return spaceName || "空间文件";
  const label =
    labels[path] || (path.startsWith("/settings/") ? "空间设置" : "minmd");
  return spaceName && label !== "minmd" ? `${label} · ${spaceName}` : label;
}
export function formatPageTitle(text: string) {
  const clean = text.replace(/[\r\n\t]+/g, " ").trim();
  return clean && clean !== "minmd" ? `${clean} · minmd` : "minmd";
}
export default function PageTitles() {
  const location = useLocation();
  const userId = useAuth((state) => state.user?.id);
  const status = useAuth((state) => state.status);
  const space = useWorkspace((state) => state.space);
  const spaceName = useWorkspace(
    (state) => state.spaces.find((item) => item.id === state.space)?.name,
  );
  const scope = `${location.key}/${userId ?? ""}/${status}/${space}`;
  const [entries, setEntries] = useState<TitleEntry[]>([]);
  const register = useMemo<Register>(
    () => (id, text, priority) => {
      setEntries((current) => [
        ...current.filter((entry) => entry.id !== id),
        { id, text, priority, scope },
      ]);
      return () =>
        setEntries((current) => current.filter((entry) => entry.id !== id));
    },
    [scope],
  );
  const active = entries
    .filter((entry) => entry.scope === scope)
    .sort((a, b) => b.priority - a.priority)[0];
  const publicPage =
    location.pathname === "/login" ||
    location.pathname === "/setup" ||
    location.pathname.startsWith("/share/");
  const text =
    (publicPage || status === "authenticated") && active
      ? active.text
      : routeTitle(
          location.pathname,
          status === "authenticated" ? spaceName : undefined,
        );
  useLayoutEffect(() => {
    document.title = formatPageTitle(text);
  }, [text]);
  return (
    <TitleContext.Provider value={register}>
      <Outlet />
    </TitleContext.Provider>
  );
}
/** 只有当前路由和身份下的已验证内容可以覆盖通用标题，旧页面清理不会覆盖新页面。 */
export function usePageTitle(text: string | null | undefined, priority = 1) {
  const register = useContext(TitleContext);
  const id = useRef(Symbol("page-title"));
  useLayoutEffect(() => {
    if (!register || text == null) return;
    return register(id.current, text, priority);
  }, [register, text, priority]);
}
