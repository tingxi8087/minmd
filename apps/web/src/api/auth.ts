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
export type SetupInput = {
  account: string;
  nickname?: string;
  password: string;
  spaceName: string;
  description?: string;
};
export type LoginSession = { csrfToken?: string; token?: string };
export type SetupResult = LoginSession & {
  spaceId: string;
  documentId: string;
};
export const authApi = {
  setupStatus: async () =>
    (await request.get<{ needsSetup: boolean }>("/app/auth/setup")).data,
  setup: async (input: SetupInput) =>
    (await request.post<SetupResult>("/app/auth/setup", input)).data,
  me: async () => (await request.get<Session>("/app/auth/me")).data,
  login: async (account: string, password: string) =>
    (await request.post<LoginSession>("/app/auth/login", { account, password }))
      .data,
  logout: async () => {
    await request.post("/app/auth/logout", {});
  },
};
