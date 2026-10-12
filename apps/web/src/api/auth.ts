import { request } from "@/http";
export type CurrentUser = {
  id: string;
  account: string;
  nickname: string;
  avatar: string;
};
export type Session = {
  user: CurrentUser;
  permissions: string[];
  csrfToken?: string;
};
export const authApi = {
  me: async () => (await request.get<Session>("/app/auth/me")).data,
  login: async (account: string, password: string) =>
    (
      await request.post<{ csrfToken?: string; token?: string }>(
        "/app/auth/login",
        { account, password },
      )
    ).data,
  logout: async () => {
    await request.post("/app/auth/logout", {});
  },
};
