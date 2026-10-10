import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileText, Share2 } from "lucide-react";
import FileIcon from "@/components/FileIcon";
import FileDialogs, { FileAction } from "@/components/FileDialogs";
import { kindNames, useWorkspace } from "@/store/workspace";
import styles from "./index.module.less";
export default function Preview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { files, space, visit } = useWorkspace();
  const file = files.find(
    (f) => f.id === id && f.space === space && !f.deleted,
  );
  const [action, setAction] = useState<FileAction | null>(null);
  useEffect(() => {
    if (file) visit(file.id);
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
  return (
    <main className={styles.page}>
      <div className={styles.toolbar}>
        <button
          className="icon-button"
          aria-label="返回空间"
          onClick={() => navigate("/files")}
        >
          <ArrowLeft size={19} />
        </button>
        <FileIcon kind={file.kind} small />
        <strong>{file.name}</strong>
        <span className="badge">{kindNames[file.kind]}预览</span>
        <button
          className="secondary-button"
          onClick={() => setAction({ type: "share", file })}
        >
          <Share2 size={15} />
          分享
        </button>
      </div>
      <div className={styles.notice}>
        <FileText size={15} />
        静态内容预览 · 编辑器尚未接入，正文暂不可编辑
      </div>
      {file.kind === "sheet" ? (
        <div className={styles.sheet}>
          <div className={styles.formula}>
            A1 <span>ƒx</span>项目
          </div>
          <table>
            <thead>
              <tr>
                <th />
                <th>A</th>
                <th>B</th>
                <th>C</th>
                <th>D</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["项目", "预算（元）", "负责人", "状态"],
                ["产品设计", "12,000", "林小满", "进行中"],
                ["研发投入", "28,000", "Tingxi", "计划中"],
                ["用户调研", "6,000", "陈一", "已完成"],
                ["合计", "46,000", "", ""],
                ...Array.from({ length: 8 }, () => ["", "", "", ""]),
              ].map((row, i) => (
                <tr key={i}>
                  <th>{i + 1}</th>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.sheetTabs}>
            项目预算 <span>+</span>
          </div>
        </div>
      ) : (
        <div className={styles.slide}>
          <span>MINMD / PRODUCT NOTES</span>
          <h1>
            让好想法发生<span>从一份简单的记录开始。</span>
          </h1>
          <p>设计与产品 · 2026</p>
          <div className={styles.slideCircle} />
        </div>
      )}
      <FileDialogs action={action} close={() => setAction(null)} />
    </main>
  );
}
