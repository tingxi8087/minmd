import FileAccessGate from "@/components/FileAccessGate";
import { kindNames, type Entry } from "@/store/workspace";
import { lazy, Suspense } from "react";
import { Navigate, useParams } from "react-router-dom";
const Media = lazy(() => import("@/views/Media"));
const Presentation = lazy(() => import("@/views/Presentation"));
const Spreadsheet = lazy(() => import("@/views/Spreadsheet"));
export default function Preview() {
  const { id } = useParams();
  return (
    <FileAccessGate fileId={id ?? ""}>
      {(file) => <EditablePreview file={file} />}
    </FileAccessGate>
  );
}
function EditablePreview({ file }: { file: Entry }) {
  if (file.kind === "doc")
    return <Navigate to={`/document/${file.id}`} replace />;
  if (file.kind === "folder")
    return <Navigate to={`/files?folder=${file.id}`} replace />;
  return (
    <Suspense
      fallback={
        <div style={{ padding: 24 }}>正在打开{kindNames[file.kind]}…</div>
      }
    >
      {file.kind === "sheet" ? (
        <Spreadsheet key={file.id} file={file} />
      ) : ["pdf", "video", "image"].includes(file.kind) ? (
        <Media key={file.id} file={file} />
      ) : (
        <Presentation key={file.id} file={file} />
      )}
    </Suspense>
  );
}
