import { create } from "zustand";
import { authApi, type CurrentUser } from "@/api/auth";
import { configureSession } from "@/http";
import { useWorkspace } from "@/store/workspace";
type AuthState = {
  user: CurrentUser | null;
  status: "idle" | "loading" | "authenticated" | "anonymous";
  error: string;
  bootstrap: () => Promise<void>;
  login: (account: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clear: () => void;
};
let generation = 0;
let pending: Promise<void> | undefined;
export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  status: "idle",
  error: "",
  clear: () => {
    generation++;
    configureSession("");
    set({ user: null, status: "anonymous" });
    useWorkspace.getState().clearSession();
  },
  bootstrap: () => {
    if (pending) return pending;
    const currentGeneration = generation;
    set({ status: "loading", error: "" });
    pending = (async () => {
      try {
        const session = await authApi.me();
        if (currentGeneration !== generation) return;
        configureSession(session.csrfToken ?? "");
        set({ user: session.user, status: "authenticated" });
        await useWorkspace.getState().loadSpaces();
      } catch (error) {
        if (currentGeneration === generation && get().status !== "anonymous") {
          const { errorMessage } = await import("@/http");
          set({ status: "anonymous", user: null, error: errorMessage(error) });
          configureSession("");
          useWorkspace.getState().clearSession();
        }
      } finally {
        pending = undefined;
      }
    })();
    return pending;
  },
  login: async (account, password) => {
    const session = await authApi.login(account.trim(), password);
    if (!session.csrfToken)
      throw new Error("前台需要 Cookie 认证，请在服务端启用 Cookie 模式");
    configureSession(session.csrfToken);
    await get().bootstrap();
    if (get().status !== "authenticated")
      throw new Error(get().error || "无法读取当前账号");
  },
  logout: async () => {
    await authApi.logout();
    get().clear();
  },
}));
configureSession("", () => useAuth.getState().clear());
