import { isDemo, FullVersion } from "@/runtime";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dropdown } from "antd";
import {
  ArrowLeft,
  Download,
  MoreHorizontal,
  Palette,
  Share2,
} from "lucide-react";
import FileHeader from "@/components/FileHeader";
import FileIcon from "@/components/FileIcon";
import TooltipButton from "@/components/TooltipButton";
import FileDialogs, { type FileAction } from "@/components/FileDialogs";
import { assetUrl } from "@/utils/assetUrl";
import { assetsApi, type PresentationProjection } from "@/api/assets";
import { type Entry, kindNames } from "@/store/workspace";
import { useLayout } from "@/store/layout";
import { errorMessage } from "@/http";
import MediaPreview, { type MediaKind } from "./MediaPreview";
import styles from "./index.module.less";
export default function Media({ file }: { file: Entry }) {
  const navigate = useNavigate();
  const [projection, setProjection] = useState<PresentationProjection>(),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [action, setAction] = useState<FileAction | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setProjection(undefined);
    void assetsApi
      .presentation(file.id, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setProjection(value.projection);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      });
    return () => controller.abort();
  }, [file.id, retry]);
  const url = projection?.assetId ? assetUrl(projection.assetId) : "";
  const download = () => {
    if (!url) return;
    const anchor = document.createElement("a");
    anchor.href = isDemo ? url : `${url}?download=true`;
    anchor.download = file.name;
    anchor.click();
  };
  return (
    <main className={styles.page}>
      <FileHeader className={styles.header}>
        <TooltipButton
          className="icon-button"
          aria-label="返回空间"
          onClick={() => navigate("/files")}
        >
          <ArrowLeft size={17} />
        </TooltipButton>
        <span className={styles.fileIcon}>
          <FileIcon kind={file.kind} small />
        </span>
        <strong>{file.name}</strong>
        <span className={styles.readonly}>{kindNames[file.kind]} · 只读</span>
        <div className={styles.actions}>
          <TooltipButton
            className="icon-button"
            aria-label="下载原文件"
            disabled={!url}
            onClick={download}
          >
            <Download size={17} />
          </TooltipButton>
          <FullVersion>
            <TooltipButton
              className="icon-button"
              aria-label="分享文件"
              onClick={() => setAction({ type: "share", file })}
            >
              <Share2 size={17} />
            </TooltipButton>
          </FullVersion>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                {
                  key: "theme",
                  label: "主题设置",
                  icon: <Palette size={15} />,
                },
                { key: "retry", label: "重新加载预览" },
              ],
              onClick: ({ key }) => {
                if (key === "theme")
                  useLayout.getState().setThemeDialogOpen(true);
                else setRetry((v) => v + 1);
              },
            }}
          >
            <TooltipButton
              className="icon-button"
              aria-label="文件更多操作"
              tooltip=""
            >
              <MoreHorizontal size={18} />
            </TooltipButton>
          </Dropdown>
        </div>
      </FileHeader>
      {error ? (
        <div className={styles.empty} role="alert">
          <p>{error}</p>
          <button
            className="secondary-button"
            onClick={() => setRetry((v) => v + 1)}
          >
            重试
          </button>
        </div>
      ) : url ? (
        <MediaPreview
          key={`${file.id}-${retry}`}
          kind={file.kind as MediaKind}
          url={url}
          name={file.name}
        />
      ) : (
        <div className={styles.empty} role="status">
          正在打开文件…
        </div>
      )}
      <FileDialogs action={action} close={() => setAction(null)} />
    </main>
  );
}
