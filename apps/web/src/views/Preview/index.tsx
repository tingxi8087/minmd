import { App } from "antd";
import { errorMessage } from "@/http";
import { lazy, Suspense, useEffect } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useWorkspace } from "@/store/workspace";
import styles from "./index.module.less";
const Presentation = lazy(() => import("@/views/Presentation"));
const Spreadsheet = lazy(() => import("@/views/Spreadsheet"));
export default function Preview() {
  const { id } = useParams(),
    navigate = useNavigate();
  const { message } = App.useApp();
  const { files, space, visit } = useWorkspace();
  const file = files.find(
    (f) => f.id === id && f.space === space && !f.deleted,
  );
  useEffect(() => {
    if (file) void visit(file.id).catch((error: unknown) => message.error(errorMessage(error)));
  }, [file?.id, visit]);
  if (!file)
    return (
      <main className={styles.page}>
        <h2>文件不存在或不在当前空间</h2>
        <button className="secondary-button" onClick={() => navigate("/files")}>
          返回空间
        </button>
      </main>
    );
  if (file.kind === "doc")
    return <Navigate to={`/document/${file.id}`} replace />;
  if (file.kind === "folder")
    return <Navigate to={`/files?folder=${file.id}`} replace />;
  return (
    <Suspense
      fallback={
        <div style={{ padding: 24 }}>
          正在打开{file.kind === "sheet" ? "表格" : "幻灯片"}…
        </div>
      }
    >
      {file.kind === "sheet" ? (
        <Spreadsheet key={file.id} file={file} />
      ) : (
        <Presentation key={file.id} file={file} />
      )}
    </Suspense>
  );
}
