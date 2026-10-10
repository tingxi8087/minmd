import eBox from "e-boxes";
import { accessStore } from "@/store/sys";
export interface AuthConfig {
  transport: "bearer" | "cookie";
  tokenStorage: "memory" | "sessionStorage" | "localStorage" | null;
  environment: string;
}
export interface CurrentAdmin {
  id: string;
  account: string;
  displayName: string;
  isSuperAdmin: boolean;
  permissions: string[];
}
export const authStore = eBox<{
  config: AuthConfig | null;
  admin: CurrentAdmin | null;
  error: string;
}>({ config: null, admin: null, error: "" });
let memoryToken: string | undefined;
let csrfToken: string | undefined;
const key = "mas-session-token";
export function setAuthConfig(config: AuthConfig) {
  authStore.config = config;
  if (config.transport === "cookie" || config.tokenStorage !== "localStorage")
    localStorage.removeItem(key);
  if (config.transport === "cookie" || config.tokenStorage !== "sessionStorage")
    sessionStorage.removeItem(key);
}
export function readToken() {
  const config = authStore.$.config;
  if (config?.transport !== "bearer") return undefined;
  if (config.tokenStorage === "memory") return memoryToken;
  return (
    (config.tokenStorage === "localStorage"
      ? localStorage
      : sessionStorage
    ).getItem(key) ?? undefined
  );
}
export function saveToken(token?: string, csrf?: string) {
  csrfToken = csrf;
  if (authStore.$.config?.transport !== "bearer" || !token) return;
  const storage = authStore.$.config.tokenStorage;
  if (storage === "memory") memoryToken = token;
  else
    (storage === "localStorage" ? localStorage : sessionStorage).setItem(
      key,
      token,
    );
}
export const readCsrf = () => csrfToken;
export function setCurrentAdmin(admin: CurrentAdmin, csrf?: string) {
  authStore.admin = admin;
  accessStore.list = admin.isSuperAdmin
    ? [...admin.permissions, "system:super-admin"]
    : admin.permissions;
  csrfToken = csrf;
}
export function clearSession() {
  memoryToken = undefined;
  csrfToken = undefined;
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
  authStore.admin = null;
  accessStore.list = [];
}
export const can = (permission: string) =>
  !!authStore.$.admin?.permissions.includes(permission);
export const landingPath = () =>
  [
    ["user:read", "/admin/users"],
    ["role:read", "/admin/roles"],
    ["log:read", "/admin/logs"],
    ["audit:read", "/admin/audit"],
    ["api:read", "/api-debug"],
  ].find(([code]) => can(code))?.[1] ?? "/403";
