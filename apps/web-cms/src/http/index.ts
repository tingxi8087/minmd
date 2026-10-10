import { clearSession, readToken, readCsrf } from "./authSession";
import { message } from "antd";
import Axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";

type HttpClientOptions = AxiosRequestConfig & {
  showBusinessError?: boolean;
};

const DEFAULT_TIMEOUT = 15000;

const getBaseURL = () => window.location.origin;

const getErrorText = (error: AxiosError) => {
  const responseData = error.response?.data;

  if (typeof responseData === "string") {
    return responseData;
  }

  if (responseData && typeof responseData === "object") {
    const data = responseData as Record<string, unknown>;
    const responseMessage = data.message || data.msg || data.error;

    if (typeof responseMessage === "string") {
      return responseMessage;
    }
  }

  return error.message || "请求失败";
};

const handleHttpError = (error: AxiosError) => {
  const status = error.response?.status;
  const errorText = getErrorText(error);

  if (status === 401) {
    if (!error.config?.url?.endsWith("/auth/login")) {
      clearSession();
      window.location.hash = "/login";
    }
    message.error(errorText);
    return;
  }

  if (status === 403) {
    message.error("暂无权限访问该资源");
    return;
  }

  if (status === 500) {
    message.error("服务器异常，请稍后重试");
    return;
  }

  message.error(errorText);
};

const prepareRequestConfig = (config: InternalAxiosRequestConfig) => {
  const url = new URL(
    config.url ?? "",
    config.baseURL ?? window.location.origin,
  );
  if (
    url.origin !== window.location.origin ||
    !url.pathname.startsWith("/api/")
  )
    throw new Error("认证客户端只允许请求当前项目后端");
  const token = readToken();
  if (token) config.headers.set("Authorization", `Bearer ${token}`);
  const csrf = readCsrf();
  if (csrf) config.headers.set("X-CSRF-Token", csrf);
  config.withCredentials = true;
  return config;
};

const unwrapResponse = (response: AxiosResponse) => response.data;

const handleBusinessError = (response: AxiosResponse) => {
  const responseData = response.data;

  if (responseData?.status === 0 && typeof responseData?.data === "string") {
    message.error(responseData.data);
  }

  return responseData;
};

export const createHttpClient = (options: HttpClientOptions = {}) => {
  const { showBusinessError = false, ...axiosConfig } = options;
  const client = Axios.create({
    baseURL: getBaseURL(),
    timeout: DEFAULT_TIMEOUT,
    ...axiosConfig,
  });

  client.interceptors.request.use(prepareRequestConfig);
  client.interceptors.response.use(
    showBusinessError ? handleBusinessError : unwrapResponse,
    (error: AxiosError) => {
      handleHttpError(error);
      return Promise.reject(error);
    },
  );

  return client;
};

export const request: AxiosInstance = createHttpClient();

export const mRequest: AxiosInstance = createHttpClient({
  showBusinessError: true,
});
