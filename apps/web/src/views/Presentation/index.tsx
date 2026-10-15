import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { App, Dropdown } from "antd";
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
  MoreHorizontal,
  PanelLeft,
  Palette,
} from "lucide-react";
import type { PptxViewer } from "@aiden0z/pptx-renderer";
import FileIcon from "@/components/FileIcon";
import FileHeader from "@/components/FileHeader";
import TooltipButton from "@/components/TooltipButton";
import FileDialogs, { type FileAction } from "@/components/FileDialogs";
import { type Entry } from "@/store/workspace";
import { validatePresentation } from "@/utils/presentationFiles";
import { assetsApi, type PresentationContent } from "@/api/assets";
import { errorMessage } from "@/http";
import { useNavigate } from "react-router-dom";
import styles from "./index.module.less";
import { useLayout } from "@/store/layout";

export default function Presentation({ file }: { file: Entry }) {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [content, setContent] = useState<PresentationContent | null>(null);
  const [contentLoading, setContentLoading] = useState(true);
  const [contentError, setContentError] = useState("");
  const [reload, setReload] = useState(0);
  const uploadController = useRef<AbortController | null>(null);
  const operation = useRef(0);
  const downloadController = useRef<AbortController | null>(null);
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
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [action, setAction] = useState<FileAction | null>(null);
  const [showThumbnails, setShowThumbnails] = useState(false);
  const count = content?.projection.slides || 0;
  const key = content?.projection.assetId;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setContent(null);
    setContentLoading(true);
    setContentError("");
    setUploading(false);
    void assetsApi
      .presentation(file.id, controller.signal)
      .then((result) => {
        if (active) setContent(result);
      })
      .catch((error: unknown) => {
        if (active) setContentError(errorMessage(error));
      })
      .finally(() => {
        if (active) setContentLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
      operation.current++;
      uploadController.current?.abort();
      downloadController.current?.abort();
    };
  }, [file.id, reload]);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const handles: { dispose: () => void }[] = [];
    let instance: PptxViewer | undefined;
    setPage(0);
    setZoom(100);
    setError("");
    if (!key) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const load = async () => {
      try {
        const binary = await assetsApi.download(key, controller.signal);
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
              width: target.clientWidth || 80,
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
    if (!binary || uploading || !content) return;
    setPendingFile(binary);
    setUploading(true);
    const currentOperation = ++operation.current;
    const controller = new AbortController();
    uploadController.current = controller;
    try {
      await validatePresentation(binary);
      if (controller.signal.aborted) return;
      const asset = await assetsApi.upload(
        file.space,
        binary,
        controller.signal,
        file.id,
      );
      const saved = await assetsApi.bindPresentation(
        file.id,
        asset.id,
        content,
        controller.signal,
      );
      if (currentOperation !== operation.current || controller.signal.aborted)
        return;
      setContent(saved);
      setContentError("");
      setPendingFile(null);
      message.success("幻灯片已保存到服务器");
      if (input.current) input.current.value = "";
    } catch (error) {
      if (
        currentOperation === operation.current &&
        !controller.signal.aborted
      ) {
        message.error(errorMessage(error));
        if (axios.isAxiosError(error) && error.response?.status === 409)
          setContentError(
            "幻灯片已被替换，请重新读取后再上传。选择的文件仍保留，可再次上传。",
          );
      }
    } finally {
      if (currentOperation === operation.current) setUploading(false);
    }
  };
  const download = async () => {
    if (!key) return;
    downloadController.current?.abort();
    const controller = new AbortController();
    downloadController.current = controller;
    const currentOperation = operation.current;
    try {
      const binary = await assetsApi.download(key, controller.signal);
      if (currentOperation !== operation.current) return;
      const url = URL.createObjectURL(binary);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = content?.projection.name || `${file.name}.pptx`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (currentOperation === operation.current)
        message.error(errorMessage(error));
    }
  };
  return (
    <main
      ref={root}
      className={styles.page}
      onKeyDown={(e) => {
        if (
          (e.target as HTMLElement).closest(
            "input,textarea,[role=dialog],[role=menu]",
          )
        )
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
        <span className={styles.fileIcon}>
          <FileIcon kind="slide" small />
        </span>
        <strong>{file.name}</strong>
        <span className={styles.readonly}>只读</span>
        <div className={styles.actions}>
          <TooltipButton
            className={`icon-button ${styles.secondaryAction}`}
            aria-label={key ? "替换 PPTX 文件" : "上传 PPTX 文件"}
            disabled={uploading || contentLoading || !content}
            onClick={() => input.current?.click()}
          >
            <Upload size={16} />
          </TooltipButton>
          <TooltipButton
            className={`icon-button ${styles.secondaryAction}`}
            aria-label="下载原始 PPTX"
            disabled={!key}
            onClick={download}
          >
            <Download size={16} />
          </TooltipButton>
          <button
            className={`secondary-button ${styles.shareButton}`}
            aria-label="分享"
            onClick={() => setAction({ type: "share", file })}
          >
            <Share2 size={15} />
            <span className={styles.shareLabel}>分享</span>
          </button>
          <Dropdown
            trigger={["click"]}
            getPopupContainer={() => root.current ?? document.body}
            menu={{
              items: [
                {
                  key: "upload",
                  label: key ? "替换 PPTX 文件" : "上传 PPTX 文件",
                  icon: <Upload size={15} />,
                  disabled: uploading || contentLoading || !content,
                },
                {
                  key: "download",
                  label: "下载原始 PPTX",
                  icon: <Download size={15} />,
                  disabled: !key,
                },
                { type: "divider" },
                {
                  key: "thumbnails",
                  label: showThumbnails ? "隐藏缩略图" : "显示缩略图",
                  icon: <PanelLeft size={15} />,
                  disabled: !key,
                },
                {
                  key: "zoom-in",
                  label: "放大幻灯片",
                  icon: <ZoomIn size={15} />,
                  disabled: !key || loading || !!error || zoom >= 200,
                },
                {
                  key: "zoom-out",
                  label: "缩小幻灯片",
                  icon: <ZoomOut size={15} />,
                  disabled: !key || loading || !!error || zoom <= 50,
                },
                {
                  key: "zoom-fit",
                  label: `适应画布（当前 ${zoom}%）`,
                  disabled: !key || loading || !!error,
                },
                ...(!fullscreen
                  ? [
                      {
                        key: "theme",
                        label: "主题设置",
                        icon: <Palette size={15} />,
                      },
                    ]
                  : []),
              ],
              onClick: ({ key: action }) => {
                if (action === "upload") input.current?.click();
                else if (action === "download") void download();
                else if (action === "thumbnails")
                  setShowThumbnails((value) => !value);
                else if (action === "zoom-in") void scale(zoom + 25);
                else if (action === "zoom-out") void scale(zoom - 25);
                else if (action === "zoom-fit") void scale(100);
                else useLayout.getState().setThemeDialogOpen(true);
              },
            }}
          >
            <TooltipButton
              className={`icon-button ${styles.mobileMore}`}
              aria-label="幻灯片更多操作"
              tooltip=""
            >
              <MoreHorizontal size={18} />
            </TooltipButton>
          </Dropdown>
        </div>
      </FileHeader>
      <input
        ref={input}
        type="file"
        accept=".pptx"
        hidden
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      {pendingFile && !uploading && (
        <div role="alert">
          {pendingFile.name} 尚未保存，原文件已保留。
          <button
            className="secondary-button"
            disabled={contentLoading || !content}
            onClick={() => void upload(pendingFile)}
          >
            重新上传
          </button>
          <button
            className="secondary-button"
            onClick={() => setPendingFile(null)}
          >
            取消
          </button>
        </div>
      )}
      {contentLoading && <p role="status">正在读取幻灯片…</p>}
      {contentError && (
        <div role="alert">
          {contentError}
          <button
            className="secondary-button"
            onClick={() => setReload(reload + 1)}
          >
            重试
          </button>
        </div>
      )}
      {key ? (
        <>
          <div className={styles.workspace}>
            <aside
              ref={thumbnails}
              className={styles.thumbnails}
              data-visible={showThumbnails || undefined}
              aria-label="幻灯片缩略图"
            >
              {Array.from({ length: count }, (_, i) => (
                <button
                  key={i}
                  aria-label={`第 ${i + 1} 页`}
                  aria-current={page === i ? "page" : undefined}
                  disabled={loading || !!error}
                  onClick={() => {
                    void go(i);
                    if (window.matchMedia("(max-width: 680px)").matches)
                      setShowThumbnails(false);
                  }}
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
            <span className={`${styles.divider} ${styles.secondaryControl}`} />
            <TooltipButton
              className={`icon-button ${styles.secondaryControl}`}
              aria-label="缩小幻灯片"
              disabled={loading || !!error || zoom <= 50}
              onClick={() => void scale(zoom - 25)}
            >
              <ZoomOut size={16} />
            </TooltipButton>
            <TooltipButton
              className={`${styles.zoom} ${styles.secondaryControl}`}
              aria-label="恢复适应画布"
              onClick={() => void scale(100)}
            >
              {zoom}%
            </TooltipButton>
            <TooltipButton
              className={`icon-button ${styles.secondaryControl}`}
              aria-label="放大幻灯片"
              disabled={loading || !!error || zoom >= 200}
              onClick={() => void scale(zoom + 25)}
            >
              <ZoomIn size={16} />
            </TooltipButton>
            <span className={`${styles.divider} ${styles.secondaryControl}`} />
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
      ) : contentLoading || contentError ? null : (
        <div className={styles.empty}>
          <FileIcon kind="slide" />
          <h2>上传幻灯片，开始预览</h2>
          <p>支持 .pptx · 最多 200 MB</p>
          <button
            className="primary-button"
            disabled={uploading || contentLoading || !content}
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
