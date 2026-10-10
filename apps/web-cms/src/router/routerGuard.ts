import { NavigateFunction, Location } from "react-router-dom";
import { hideSideNav, hideTopNav } from "./routerUtils";
import { authStore } from "@/http/authSession";
import { loadAuthConfig, restoreSession } from "@/http/services/auth";
export async function befroeCreated() {
  try {
    await loadAuthConfig();
    await restoreSession();
  } catch {
    authStore.error = "无法连接后端，请确认服务已启动";
  }
}
export const beforePageChange: (
  navigate: NavigateFunction,
  location: Location,
) => Promise<string | boolean> = async (navigate, location) => {
  hideSideNav(["/login"], location);
  hideTopNav(["/login"], location);
  if (location.pathname === "/login") return true;
  try {
    if (!(await restoreSession())) return "/login";
  } catch {
    authStore.error = "无法连接后端，请确认服务已启动";
    return "/login";
  }
  const { aceessValid } = await import("@/.utils/access");
  return aceessValid(location, navigate) ? true : "/403";
};
