import { useState } from "react";
import { Maximize, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import TooltipButton from "@/components/TooltipButton";
import styles from "./index.module.less";
export type MediaKind = "pdf" | "image" | "video";
export default function MediaPreview({
  kind,
  url,
  name,
}: {
  kind: MediaKind;
  url: string;
  name: string;
}) {
  const [zoom, setZoom] = useState(100),
    [error, setError] = useState(false);
  return (
    <div className={styles.preview}>
      <div className={styles.canvas}>
        {kind === "pdf" ? (
          <iframe
            title={`PDF 预览：${name}`}
            src={`${url}#view=FitH`}
            className={styles.pdf}
          />
        ) : kind === "video" ? (
          <div className={styles.videoWrap}>
            <video
              aria-label={`视频预览：${name}`}
              src={url}
              controls
              playsInline
              preload="metadata"
              onError={() => setError(true)}
            />
            {error && (
              <p role="alert">
                浏览器无法播放此视频编码，请下载后使用本地播放器打开。
              </p>
            )}
          </div>
        ) : (
          <div className={styles.imageScroll}>
            <img
              aria-label={`图片预览：${name}`}
              alt={name}
              src={url}
              style={{
                width: zoom === 100 ? undefined : `${zoom}%`,
                maxWidth: zoom === 100 ? "100%" : "none",
                maxHeight: zoom === 100 ? "100%" : "none",
              }}
              onError={() => setError(true)}
            />
            {error && <p role="alert">图片加载失败，请重试或下载原文件。</p>}
          </div>
        )}
      </div>
      {kind === "image" && (
        <div className={styles.controls} aria-label="图片查看工具">
          <TooltipButton
            className="icon-button"
            aria-label="缩小图片"
            disabled={zoom <= 50}
            onClick={() => setZoom((v) => v - 25)}
          >
            <ZoomOut size={16} />
          </TooltipButton>
          <span>{zoom}%</span>
          <TooltipButton
            className="icon-button"
            aria-label="放大图片"
            disabled={zoom >= 300}
            onClick={() => setZoom((v) => v + 25)}
          >
            <ZoomIn size={16} />
          </TooltipButton>
          <TooltipButton
            className="icon-button"
            aria-label="适应画布"
            onClick={() => setZoom(100)}
          >
            <RotateCcw size={16} />
          </TooltipButton>
          <TooltipButton
            className="icon-button"
            aria-label="全屏查看图片"
            disabled={!document.fullscreenEnabled}
            onClick={(event) =>
              void event.currentTarget
                .closest(`.${styles.preview}`)
                ?.requestFullscreen?.()
                .catch(() => {})
            }
          >
            <Maximize size={16} />
          </TooltipButton>
        </div>
      )}
      {kind === "pdf" && (
        <p className={styles.hint}>若浏览器未显示预览，可下载 PDF 后查看。</p>
      )}
    </div>
  );
}
