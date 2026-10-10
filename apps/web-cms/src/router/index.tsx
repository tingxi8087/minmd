import AppUsers from "@/views/AppUsers";
import Database from "@/views/Database";
import ApiDebug from "@/views/ApiDebug";
import RoleManage from "@/views/RoleManage";
import RuntimeLogs from "@/views/RuntimeLogs";
import AuditLogs from "@/views/AuditLogs";
import {
  AppstoreOutlined,
  UserOutlined,
  CodeOutlined,
  DatabaseOutlined,
  SafetyOutlined,
} from "@ant-design/icons";
import { Navigate, createHashRouter } from "react-router-dom";
import { wrapRoutesWithAuth } from "@/.utils/access";
import { getReactRouter, useLayout } from "@/.utils/routerRender";
import AdminAccounts from "@/views/AdminAccounts";
import Login from "@/views/Login";
import Page403 from "@/views/403";
import Page404 from "@/views/404";

// import { HashRouter } from "react-router-dom";
const Router: MasRouter = [
  {
    path: "/",
    hideMenu: true,
    element: <Navigate to="/app-users" replace />,
  },
  {
    path: "/system",
    label: "系统管理",
    icon: <SafetyOutlined aria-hidden />,
    children: [
      {
        path: "/system/access",
        label: "权限管理",
        icon: <SafetyOutlined aria-hidden />,
        children: [
          {
            path: "/admin/users",
            label: "管理员账号",
            access: "user:read",
            icon: <AppstoreOutlined aria-hidden />,
            element: <AdminAccounts />,
          },
          {
            path: "/admin/roles",
            label: "角色与权限",
            access: "role:read",
            icon: <SafetyOutlined aria-hidden />,
            element: <RoleManage />,
          },
        ],
      },
      {
        path: "/system/tools",
        label: "开发工具",
        icon: <CodeOutlined aria-hidden />,
        children: [
          {
            path: "/database",
            label: "数据库",
            access: "system:super-admin",
            icon: <DatabaseOutlined aria-hidden />,
            element: <Database />,
          },
          {
            path: "/api-debug",
            label: "接口调试",
            access: "api:read",
            icon: <CodeOutlined aria-hidden />,
            element: <ApiDebug />,
          },
          {
            path: "/admin/logs",
            label: "运行日志",
            access: "log:read",
            icon: <DatabaseOutlined aria-hidden />,
            element: <RuntimeLogs />,
          },
          {
            path: "/admin/audit",
            label: "操作审计",
            access: "audit:read",
            icon: <CodeOutlined aria-hidden />,
            element: <AuditLogs />,
          },
        ],
      },
    ],
  },
  {
    path: "/app-users",
    label: "前台用户管理",
    access: "app-user:read",
    icon: <UserOutlined aria-hidden />,
    element: <AppUsers />,
  },
  {
    path: "/admin",
    hideMenu: true,
    element: <Navigate to="/admin/users" replace />,
  },
  { path: "/login", hideMenu: true, element: <Login /> },
  { path: "/403", hideMenu: true, element: <Page403 /> },
  { path: "*", hideMenu: true, element: <Page404 /> },
];

const { reactRouter, accessArr } = getReactRouter(
  useLayout(wrapRoutesWithAuth(Router)),
);
// eslint-disable-next-line react-refresh/only-export-components
export const router = createHashRouter(reactRouter);
// eslint-disable-next-line react-refresh/only-export-components
export const routerAccessData = accessArr;
export const RouterIndex = Router;
