import { useEffect, useState } from "react";
import { Button } from "antd";
import { useNavigate } from "react-router-dom";
import { fileAccessApi } from "@/api/fileAccess";
import type { RemoteFile } from "@/api/files";
import { errorMessage } from "@/http";
import FileIcon from "@/components/FileIcon";
export default function SharedWithMe() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<RemoteFile[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void fileAccessApi
      .sharedWithMe()
      .then((value) => {
        if (active) setFiles(value);
      })
      .catch((error: unknown) => {
        if (active) setError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  return (
    <main style={{ padding: "16px 20px", flex: 1, overflow: "auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>分享给我的</h2>
        <Button size="small" onClick={() => setReload((value) => value + 1)}>
          刷新
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>正在加载…</p>
      ) : !files.length ? (
        <p>暂时没有分享给你的文件</p>
      ) : (
        files.map((file) => (
          <button
            key={file.id}
            className="secondary-button"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              marginBottom: 6,
              padding: "8px 10px",
              justifyContent: "flex-start",
            }}
            onClick={() =>
              navigate(
                `${file.kind === "doc" ? "/document/" : "/preview/"}${file.id}`,
              )
            }
          >
            <FileIcon kind={file.kind} small />
            <span>{file.name}</span>
          </button>
        ))
      )}
    </main>
  );
}
