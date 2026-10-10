import axios from "axios";
// 静态演示不发起业务请求；接入后端时所有请求从此处配置。
export const request = axios.create({
  baseURL: "/api",
  timeout: 15000,
  withCredentials: true,
});
