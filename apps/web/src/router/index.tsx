import { lazy, Suspense } from "react";
import { createHashRouter, Navigate } from "react-router-dom";
import Layout from "@/layout";
import Files from "@/views/Files";
import Settings from "@/views/Settings";
import Preview from "@/views/Preview";
import Login from "@/views/Login";
const Document = lazy(() => import("@/views/Document"));
export const router = createHashRouter([
  { path: "/login", element: <Login /> },
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/files" replace /> },
      ...["files", "recent", "favorites", "shared", "trash"].map((path) => ({
        path,
        element: <Files />,
      })),
      { path: "settings/:section", element: <Settings /> },
      {
        path: "document/:id",
        element: (
          <Suspense fallback={<div style={{ padding: 40 }}>正在打开文档…</div>}>
            <Document />
          </Suspense>
        ),
      },
      { path: "preview/:id", element: <Preview /> },
      { path: "*", element: <Navigate to="/files" replace /> },
    ],
  },
]);
