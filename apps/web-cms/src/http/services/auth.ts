import { request } from "@/http";
import {
  AuthConfig,
  CurrentAdmin,
  authStore,
  clearSession,
  readToken,
  saveToken,
  setAuthConfig,
  setCurrentAdmin,
} from "../authSession";
export async function loadAuthConfig() {
  const config = await request.get<never, AuthConfig>("/api/auth/config");
  setAuthConfig(config);
  authStore.error = "";
}
export async function refreshIdentity() {
  const result = await request.get<
    never,
    { admin: CurrentAdmin; csrfToken?: string }
  >("/api/auth/me");
  setCurrentAdmin(result.admin, result.csrfToken);
}
export async function restoreSession() {
  if (!authStore.$.config) await loadAuthConfig();
  if (authStore.$.config?.transport === "bearer" && !readToken()) return false;
  try {
    await refreshIdentity();
    return true;
  } catch {
    return false;
  }
}
export async function login(values: { account: string; password: string }) {
  await loadAuthConfig();
  const result = await request.post<
    never,
    { token?: string; csrfToken?: string }
  >("/api/auth/login", values);
  saveToken(result.token, result.csrfToken);
  await refreshIdentity();
}
export async function logout() {
  await request.post("/api/auth/logout", {});
  clearSession();
}
