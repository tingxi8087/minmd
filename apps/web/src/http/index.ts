import axios from "axios";
let csrfToken = "";
let onUnauthorized = () => {};
let sessionGeneration = 0;
const requestSessions = new WeakMap<object, number>();
export function configureSession(token: string, unauthorized?: () => void) {
  sessionGeneration++;
  csrfToken = token;
  if (unauthorized) onUnauthorized = unauthorized;
}
export const request = axios.create({
  baseURL: "/api",
  timeout: 15000,
  withCredentials: true,
});
request.interceptors.request.use((config) => {
  requestSessions.set(config, sessionGeneration);
  if (
    csrfToken &&
    !["get", "head", "options"].includes(config.method ?? "get")
  ) {
    config.headers.set("x-csrf-token", csrfToken);
  }
  return config;
});
request.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      error.config?.url?.startsWith("/app/") &&
      requestSessions.get(error.config) === sessionGeneration
    )
      onUnauthorized();
    return Promise.reject(error);
  },
);
export function errorMessage(error: unknown): string {
  if (axios.isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? "连接失败，请稍后重试";
  }
  return error instanceof Error ? error.message : "操作失败";
}
