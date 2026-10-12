import { useEffect, useRef, useState } from "react";
import type { PptxViewer } from "@aiden0z/pptx-renderer";
import type { PresentationProjection } from "@/api/assets";
import { sharesApi } from "@/api/shares";
import { errorMessage } from "@/http";
export default function SharedPresentation({
  token,
  projection,
}: {
  token: string;
  projection: PresentationProjection;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const viewer = useRef<PptxViewer | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const count = projection.slides ?? 0;
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let instance: PptxViewer | undefined;
    setLoading(true);
    setError("");
    setPage(0);
    void (async () => {
      if (!projection.assetId) throw new Error("此幻灯片尚未上传文件");
      const blob = await sharesApi.asset(
        token,
        projection.assetId,
        controller.signal,
      );
      const { PptxViewer, RECOMMENDED_ZIP_LIMITS } =
        await import("@aiden0z/pptx-renderer");
      if (!active || !canvas.current) return;
      instance = new PptxViewer(canvas.current, {
        fitMode: "contain",
        zipLimits: RECOMMENDED_ZIP_LIMITS,
      });
      viewer.current = instance;
      await instance.open(await blob.arrayBuffer(), {
        renderMode: "slide",
        signal: controller.signal,
      });
    })()
      .catch((error: unknown) => {
        if (active) setError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
      instance?.destroy();
      if (viewer.current === instance) viewer.current = null;
    };
  }, [token, projection.assetId]);
  const show = async (next: number) => {
    if (!viewer.current || loading || next < 0 || next >= count) return;
    try {
      await viewer.current.renderSlide(next);
      setPage(next);
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  return (
    <>
      <div className="share-slide" ref={canvas} />
      {loading && <p role="status">正在读取幻灯片…</p>}
      {error && <p role="alert">{error}</p>}
      <div className="share-controls">
        <button
          className="secondary-button"
          disabled={loading || page === 0}
          onClick={() => void show(page - 1)}
        >
          上一页
        </button>
        <span>
          {page + 1} / {count}
        </span>
        <button
          className="secondary-button"
          disabled={loading || page >= count - 1}
          onClick={() => void show(page + 1)}
        >
          下一页
        </button>
        {projection.assetId && (
          <a
            className="secondary-button"
            href={sharesApi.assetUrl(token, projection.assetId, true)}
            download
          >
            下载原文件
          </a>
        )}
      </div>
    </>
  );
}
