import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Maximize2, Minus, Plus, Scan } from "lucide-react";
import TooltipButton from "@/components/TooltipButton";
import styles from "./index.module.less";

function diagramSize(svg: string) {
  const element = new DOMParser().parseFromString(
    svg,
    "image/svg+xml",
  ).documentElement;
  const box = element
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const width =
    box?.[2] ?? Number.parseFloat(element.getAttribute("width") || "");
  const height =
    box?.[3] ?? Number.parseFloat(element.getAttribute("height") || "");
  return {
    width: Number.isFinite(width) && width > 0 ? width : 800,
    height: Number.isFinite(height) && height > 0 ? height : 400,
  };
}

export default function DiagramCanvas({
  svg,
  fullscreen = false,
  onExpand,
}: {
  svg: string;
  fullscreen?: boolean;
  onExpand?: () => void;
}) {
  const instance = useId().replace(/:/g, "");
  const markup = useMemo(() => {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const elements = [...doc.querySelectorAll("[id]")];
    const ids = new Map(
      elements.map((element) => [element.id, `${instance}-${element.id}`]),
    );
    const rewrite = (value: string) =>
      value.replace(/#([\w:.-]+)/g, (match, id: string) =>
        ids.has(id) ? `#${ids.get(id)}` : match,
      );
    // 同一 SVG 同时出现在预览与弹层时，标记和样式引用必须各自独立。
    for (const element of [
      doc.documentElement,
      ...doc.documentElement.querySelectorAll("*"),
    ]) {
      for (const attribute of [...element.attributes]) {
        if (attribute.name === "id")
          element.setAttribute(
            "id",
            ids.get(attribute.value) || attribute.value,
          );
        else if (
          ["aria-labelledby", "aria-describedby"].includes(attribute.name)
        )
          attribute.value = attribute.value
            .split(/\s+/)
            .map((id) => ids.get(id) || id)
            .join(" ");
        else attribute.value = rewrite(attribute.value);
      }
      if (element.localName === "style")
        element.textContent = rewrite(element.textContent || "");
    }
    return new XMLSerializer().serializeToString(doc.documentElement);
  }, [svg, instance]);
  const viewport = useRef<HTMLDivElement>(null);
  const size = useMemo(() => diagramSize(svg), [svg]);
  const [bounds, setBounds] = useState({ width: 800, height: 320 });
  const [{ zoom, pan }, setView] = useState<{
    zoom: number | null;
    pan: { x: number; y: number };
  }>({ zoom: null, pan: { x: 0, y: 0 } });
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    origin: typeof pan;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fit = Math.min(
    1,
    Math.max(1, bounds.width - 48) / size.width,
    Math.max(1, bounds.height - 48) / size.height,
  );
  const scale = zoom ?? fit;
  const adjust = useCallback(
    (factor: number) => {
      setView((current) => ({
        ...current,
        zoom: Math.min(4, Math.max(0.01, (current.zoom ?? fit) * factor)),
      }));
    },
    [fit],
  );
  useEffect(() => {
    const element = viewport.current;
    if (!fullscreen || !element) return;
    const scope = element.closest('[role="dialog"]') ?? element.parentElement;
    if (!scope) return;
    const shortcut = (event: Event) => {
      if (
        !(event instanceof KeyboardEvent) ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]',
        )
      )
        return;
      const increase =
        ["+", "="].includes(event.key) || event.code === "NumpadAdd";
      const decrease = event.key === "-" || event.code === "NumpadSubtract";
      if (!increase && !decrease) return;
      event.preventDefault();
      event.stopPropagation();
      adjust(increase ? 1.25 : 1 / 1.25);
    };
    scope.addEventListener("keydown", shortcut, true);
    return () => scope.removeEventListener("keydown", shortcut, true);
  }, [fullscreen, adjust]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () =>
      setBounds({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = viewport.current;
    if (!fullscreen || !element) return;
    let safariUntil = 0;
    let gestureScale = 1;
    const pinch = (factor: number, event: Event) => {
      const rect = element.getBoundingClientRect();
      const x =
        "clientX" in event && typeof event.clientX === "number"
          ? event.clientX - rect.left - rect.width / 2
          : 0;
      const y =
        "clientY" in event && typeof event.clientY === "number"
          ? event.clientY - rect.top - rect.height / 2
          : 0;
      setView((current) => {
        const previous = current.zoom ?? fit;
        const next = Math.min(4, Math.max(0.01, previous * factor));
        const ratio = next / previous;
        return {
          zoom: next,
          pan: {
            x: x - (x - current.pan.x) * ratio,
            y: y - (y - current.pan.y) * ratio,
          },
        };
      });
    };
    const move = (event: WheelEvent) => {
      if (event.metaKey) return;
      if (event.ctrlKey) {
        event.preventDefault();
        // Chromium 将触控板捏合映射为 Ctrl+wheel；Safari 原生手势期间忽略重复事件。
        if (performance.now() >= safariUntil) {
          const unit =
            event.deltaMode === 1
              ? 16
              : event.deltaMode === 2
                ? element.clientHeight
                : 1;
          pinch(
            Math.exp(
              -Math.max(-100, Math.min(100, event.deltaY * unit)) * 0.01,
            ),
            event,
          );
        }
        return;
      }
      if (performance.now() < safariUntil) {
        event.preventDefault();
        return;
      }
      // 仅全屏画布消费滚轮；非 passive 监听避免滚动同时传给弹层外的文档。
      event.preventDefault();
      const unitX =
        event.deltaMode === 2
          ? element.clientWidth
          : event.deltaMode === 1
            ? 16
            : 1;
      const unitY =
        event.deltaMode === 2
          ? element.clientHeight
          : event.deltaMode === 1
            ? 16
            : 1;
      const x = event.shiftKey
        ? (event.deltaX || event.deltaY) * unitX
        : event.deltaX * unitX;
      const y = event.shiftKey ? 0 : event.deltaY * unitY;
      setView((current) => ({
        ...current,
        pan: { x: current.pan.x - x, y: current.pan.y - y },
      }));
    };
    const start = (event: Event) => {
      event.preventDefault();
      safariUntil = Infinity;
      gestureScale = 1;
    };
    const change = (event: Event) => {
      event.preventDefault();
      if (
        !("scale" in event) ||
        typeof event.scale !== "number" ||
        !Number.isFinite(event.scale) ||
        event.scale <= 0
      )
        return;
      pinch(event.scale / gestureScale, event);
      gestureScale = event.scale;
    };
    const end = (event: Event) => {
      event.preventDefault();
      // 少数浏览器在 gestureend 后仍派发尾部 wheel，避免同一手势缩放两次。
      safariUntil = performance.now() + 120;
    };
    element.addEventListener("wheel", move, { passive: false });
    element.addEventListener("gesturestart", start, { passive: false });
    element.addEventListener("gesturechange", change, { passive: false });
    element.addEventListener("gestureend", end, { passive: false });
    return () => {
      element.removeEventListener("wheel", move);
      element.removeEventListener("gesturestart", start);
      element.removeEventListener("gesturechange", change);
      element.removeEventListener("gestureend", end);
    };
  }, [fullscreen, fit]);
  useEffect(() => {
    setView({ zoom: null, pan: { x: 0, y: 0 } });
  }, [svg]);
  const reset = () => {
    setView({ zoom: null, pan: { x: 0, y: 0 } });
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };
  return (
    <div
      className={`${styles.canvas} ${fullscreen ? styles.expandedCanvas : ""}`}
    >
      <div
        className={styles.tools}
        role="toolbar"
        aria-label={fullscreen ? "全屏图表工具" : "图表预览工具"}
      >
        <span className={styles.hint}>
          {fullscreen ? "捏合缩放 · 滚动移动" : "拖动查看"}
        </span>
        <TooltipButton
          aria-label="缩小图表"
          tooltip={fullscreen ? "缩小图表（－）" : undefined}
          disabled={scale <= 0.01}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => adjust(1 / 1.25)}
        >
          <Minus size={15} />
        </TooltipButton>
        <output aria-label="图表缩放比例">{Math.round(scale * 100)}%</output>
        <TooltipButton
          aria-label="放大图表"
          tooltip={fullscreen ? "放大图表（＋ / ＝）" : undefined}
          disabled={scale >= 4}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => adjust(1.25)}
        >
          <Plus size={15} />
        </TooltipButton>
        <TooltipButton
          aria-label={fullscreen ? "适应窗口" : "适应预览"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={reset}
        >
          <Scan size={15} />
        </TooltipButton>
        {onExpand && (
          <TooltipButton
            aria-label="全屏查看图表"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onExpand}
          >
            <Maximize2 size={15} />
          </TooltipButton>
        )}
      </div>
      <div
        ref={viewport}
        className={`${styles.viewport} ${dragging ? styles.dragging : ""}`}
        aria-label={fullscreen ? "全屏图表画布" : "图表预览画布"}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            (!fullscreen && event.pointerType === "touch")
          )
            return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            origin: pan,
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.id !== event.pointerId) return;
          setView((view) => ({
            ...view,
            pan: {
              x: current.origin.x + event.clientX - current.x,
              y: current.origin.y + event.clientY - current.y,
            },
          }));
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          endDrag();
        }}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <div
          className={styles.position}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
        >
          <div
            className={styles.svg}
            style={{ width: size.width * scale, height: size.height * scale }}
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        </div>
      </div>
    </div>
  );
}
