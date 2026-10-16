import { isDemo } from "@/runtime";
import PageTitles from "@/components/PageTitles";
import { lazy, Suspense } from "react";
import { createHashRouter, Navigate } from "react-router-dom";
import Layout from "@/layout";
import Files from "@/views/Files";
import Settings from "@/views/Settings";
import Preview from "@/views/Preview";
import Login from "@/views/Login";
import Setup from "@/views/Setup";
const SharedWithMe = lazy(() => import("@/views/SharedWithMe"));
const Notifications = lazy(() => import("@/views/Notifications"));
const Share = lazy(() => import("@/views/Share"));
const Document = lazy(() => import("@/views/Document"));
const demoPaths = [
  "/files",
  "/recent",
  "/favorites",
  "/trash",
  "/preview/:id",
  "/document/:id",
  "/",
];
export const router = createHashRouter([
  {
    element: <PageTitles />,
    children: [
      { path: "/login", element: <Login /> },
      { path: "/setup", element: <Setup /> },
      {
        path: "/share/:token",
        element: (
          <Suspense fallback={<div>正在打开分享…</div>}>
            <Share />
          </Suspense>
        ),
      },
      {
        path: "/",
        element: <Layout />,
        children: [
          { index: true as const, element: <Navigate to="/files" replace /> },
          ...["files", "recent", "favorites", "shared", "trash"].map(
            (path) => ({
              path,
              element: <Files />,
            }),
          ),
          {
            path: "shared-with-me",
            element: (
              <Suspense fallback={<div>正在加载…</div>}>
                <SharedWithMe />
              </Suspense>
            ),
          },
          {
            path: "notifications",
            element: (
              <Suspense fallback={<div>正在加载…</div>}>
                <Notifications />
              </Suspense>
            ),
          },
          { path: "settings/:section", element: <Settings /> },
          {
            path: "document/:id",
            element: (
              <Suspense
                fallback={<div style={{ padding: 40 }}>正在打开文档…</div>}
              >
                <Document />
              </Suspense>
            ),
          },
          { path: "preview/:id", element: <Preview /> },
          { path: "*", element: <Navigate to="/files" replace /> },
        ].filter(
          (route) =>
            !isDemo ||
            ("index" in route && route.index) ||
            ("path" in route &&
              (demoPaths.includes("/" + route.path) || route.path === "*")),
        ),
      },
    ].filter((route) => !isDemo || route.path === "/"),
  },
]);
