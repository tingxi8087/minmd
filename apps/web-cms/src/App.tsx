import zhCN from "antd/es/locale/zh_CN"; // 引入中文语言包
import { router } from "@/router";
import { ConfigProvider } from "antd";
import { RouterProvider } from "react-router-dom";
export default function App() {
  return (
    <ConfigProvider locale={zhCN}>
      <RouterProvider router={router} />
    </ConfigProvider>
  );
}
