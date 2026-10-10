import { useLayoutEffect, useMemo } from "react";
import { ConfigProvider, App as AntApp, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { RouterProvider } from "react-router-dom";
import { router } from "@/router";
import { useWorkspace } from "@/store/workspace";
export default function App() {
  const theme = useWorkspace((s) => s.theme);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const tokens = useMemo(() => {
    document.documentElement.dataset.theme = theme;
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    return {
      colorPrimary: v("--accent"),
      colorBgContainer: v("--surface"),
      colorBgElevated: v("--surface"),
      colorText: v("--text"),
      colorTextSecondary: v("--text-secondary"),
      colorBorder: v("--border"),
      colorError: v("--danger"),
      borderRadius: 6,
      fontFamily: v("--font-body"),
      fontSize: 14,
    };
  }, [theme]);
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm:
          theme === "dark"
            ? antdTheme.darkAlgorithm
            : antdTheme.defaultAlgorithm,
        token: tokens,
      }}
    >
      <AntApp>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </AntApp>
    </ConfigProvider>
  );
}
