import { useEffect, useRef, useState } from "react";
import { App } from "antd";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize,
  Minimize,
  Share2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { PptxViewer } from "@aiden0z/pptx-renderer";
import FileIcon from "@/components/FileIcon";
import FileHeader from "@/components/FileHeader";
import TooltipButton from "@/components/TooltipButton";
import FileDialogs, { type FileAction } from "@/components/FileDialogs";
import { type Entry, useWorkspace } from "@/store/workspace";
import {
  getPresentation,
  deletePresentation,
  savePresentation,
  validatePresentation,
} from "@/utils/presentationFiles";
import { useNavigate } from "react-router-dom";
import styles from "./index.module.less";

export default function Presentation({ file }: { file: Entry }) {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const patch = useWorkspace((s) => s.patch);
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const thumbnails = useRef<HTMLDivElement>(null);
  const viewer = useRef<PptxViewer | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [action, setAction] = useState<FileAction | null>(null);
  const count = file.presentation?.slides || 0;
  const key = file.presentation?.key;
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const handles: { dispose: () => void }[] = [];
    let instance: PptxViewer | undefined;
    setPage(0);
    setZoom(100);
    setError("");
    if (!key) return;
    setLoading(true);
    const load = async () => {
      try {
        const binary = await getPresentation(key);
        if (!binary) throw new Error("本机原文件不存在，请重新上传");
        const { PptxViewer, RECOMMENDED_ZIP_LIMITS } =
          await import("@aiden0z/pptx-renderer");
        if (cancelled) return;
        instance = new PptxViewer(canvas.current!, {
          fitMode: "contain",
          zipLimits: RECOMMENDED_ZIP_LIMITS,
        });
        viewer.current = instance;
        await instance.open(await binary.arrayBuffer(), {
          renderMode: "slide",
          signal: controller.signal,
        });
        if (cancelled) return;
        for (let index = 0; index < count; index++) {
          const target = thumbnails.current?.querySelector<HTMLElement>(
            `[data-slide="${index}"]`,
          );
          if (target) {
            const handle = instance.renderThumbnailToContainer(index, target, {
              width: target.clientWidth,
            });
            if (handle) handles.push(handle);
          }
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "幻灯片读取失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
      handles.forEach((h) => h.dispose());
      instance?.destroy();
      if (viewer.current === instance) viewer.current = null;
    };
  }, [key, count]);
  useEffect(() => {
    const change = () =>
      setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  const go = async (next: number) => {
    if (
      !viewer.current ||
      loading ||
      next === page ||
      next < 0 ||
      next >= count
    )
      return;
    try {
      await viewer.current.renderSlide(next);
      setPage(next);
    } catch {
      message.error("此页预览失败");
    }
  };
  const scale = async (next: number) => {
    if (!viewer.current) return;
    try {
      await viewer.current.setZoom(next);
      setZoom(next);
    } catch {
      message.error("缩放失败");
    }
  };
  const upload = async (binary?: File) => {
    if (!binary || uploading) return;
    setUploading(true);
    try {
      const slides = await validatePresentation(binary);
      const storageKey = crypto.randomUUID();
      await savePresentation(storageKey, binary);
      patch(file.id, {
        presentation: {
          key: storageKey,
          name: binary.name,
          size: binary.size,
          slides,
        },
      });
      message.success("幻灯片已保存到本机浏览器");
      if (key) void deletePresentation(key).catch(() => {});
    } catch (e) {
      message.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };
  const download = async () => {
    try {
      const binary = key && (await getPresentation(key));
      if (!binary) throw new Error("本机原文件不存在");
      const url = URL.createObjectURL(binary);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.presentation!.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "下载失败");
    }
  };
  return (
    <main
      ref={root}
      className={styles.page}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("input,textarea,[role=dialog]"))
          return;
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          void go(page + (e.key === "ArrowRight" ? 1 : -1));
        }
      }}
      tabIndex={0}
      aria-label="幻灯片只读预览"
    >
      <FileHeader className={styles.header} fullscreen={fullscreen}>
        <TooltipButton
          className="icon-button"
          aria-label="返回空间"
          onClick={() => navigate("/files")}
        >
          <ArrowLeft size={17} />
        </TooltipButton>
        <FileIcon kind="slide" small />
        <strong>{file.name}</strong>
        <span className={styles.readonly}>只读</span>
        <div className={styles.actions}>
          <TooltipButton
            className="icon-button"
            aria-label={key ? "替换 PPTX 文件" : "上传 PPTX 文件"}
            disabled={uploading}
            onClick={() => input.current?.click()}
          >
            <Upload size={16} />
          </TooltipButton>
          <TooltipButton
            className="icon-button"
            aria-label="下载原始 PPTX"
            disabled={!key}
            onClick={download}
          >
            <Download size={16} />
          </TooltipButton>
          <button
            className="secondary-button"
            onClick={() => setAction({ type: "share", file })}
          >
            <Share2 size={15} />
            分享
          </button>
        </div>
      </FileHeader>
      <input
        ref={input}
        type="file"
        accept=".pptx"
        hidden
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      {key ? (
        <>
          <div className={styles.workspace}>
            <aside
              ref={thumbnails}
              className={styles.thumbnails}
              aria-label="幻灯片缩略图"
            >
              {Array.from({ length: count }, (_, i) => (
                <button
                  key={i}
                  aria-label={`第 ${i + 1} 页`}
                  aria-current={page === i ? "page" : undefined}
                  disabled={loading || !!error}
                  onClick={() => void go(i)}
                >
                  <span data-slide={i} className={styles.thumbnail} />
                  <span>{i + 1}</span>
                </button>
              ))}
            </aside>
            <section className={styles.stage}>
              <div
                ref={canvas}
                className={styles.canvas}
                aria-label="当前幻灯片"
              />
              {(loading || error) && (
                <div className={styles.status}>
                  {loading ? (
                    "正在读取幻灯片…"
                  ) : (
                    <>
                      <p>{error}</p>
                      <button
                        className="secondary-button"
                        onClick={() => input.current?.click()}
                      >
                        重新上传
                      </button>
                    </>
                  )}
                </div>
              )}
            </section>
          </div>
          <footer className={styles.controls}>
            <TooltipButton
              className="icon-button"
              aria-label="上一页"
              disabled={loading || !!error || page === 0}
              onClick={() => void go(page - 1)}
            >
              <ChevronLeft size={17} />
            </TooltipButton>
            <span>
              {page + 1} / {count}
            </span>
            <TooltipButton
              className="icon-button"
              aria-label="下一页"
              disabled={loading || !!error || page === count - 1}
              onClick={() => void go(page + 1)}
            >
              <ChevronRight size={17} />
            </TooltipButton>
            <span className={styles.divider} />
            <TooltipButton
              className="icon-button"
              aria-label="缩小幻灯片"
              disabled={loading || !!error || zoom <= 50}
              onClick={() => void scale(zoom - 25)}
            >
              <ZoomOut size={16} />
            </TooltipButton>
            <TooltipButton
              className={styles.zoom}
              aria-label="恢复适应画布"
              onClick={() => void scale(100)}
            >
              {zoom}%
            </TooltipButton>
            <TooltipButton
              className="icon-button"
              aria-label="放大幻灯片"
              disabled={loading || !!error || zoom >= 200}
              onClick={() => void scale(zoom + 25)}
            >
              <ZoomIn size={16} />
            </TooltipButton>
            <span className={styles.divider} />
            <TooltipButton
              className="icon-button"
              aria-label={fullscreen ? "退出全屏" : "全屏预览"}
              onClick={async () => {
                try {
                  if (fullscreen) await document.exitFullscreen();
                  else await root.current?.requestFullscreen();
                } catch {
                  message.warning("当前浏览器不支持全屏");
                }
              }}
            >
              {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </TooltipButton>
          </footer>
        </>
      ) : (
        <div className={styles.empty}>
          <FileIcon kind="slide" />
          <h2>上传幻灯片，开始预览</h2>
          <p>支持 .pptx · 最多 50 MB · 文件保存在本机浏览器</p>
          <button
            className="primary-button"
            disabled={uploading}
            onClick={() => input.current?.click()}
          >
            <Upload size={16} />
            {uploading ? "正在读取…" : "选择 PPTX 文件"}
          </button>
        </div>
      )}
      <FileDialogs action={action} close={() => setAction(null)} />
    </main>
  );
}
