import { useEffect, useState } from "react";
import { Modal } from "antd";
import DiagramCanvas from "./DiagramCanvas";
import { useWorkspace } from "@/store/workspace";
import { MERMAID_MAX_SOURCE, renderMermaid } from "./render";
import styles from "./index.module.less";
export default function MermaidDiagram({ source }: { source: string }) {
  const [expanded, setExpanded] = useState(false);
  const theme = useWorkspace((state) => state.theme);
  const [result, setResult] = useState({ svg: "", error: "" }),
    [pending, setPending] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    const timer = setTimeout(() => {
      if (!source.trim()) {
        setResult({ svg: "", error: "" });
        setPending(false);
        return;
      }
      void renderMermaid(source, theme, controller.signal)
        .then((svg) => {
          if (!controller.signal.aborted) setResult({ svg, error: "" });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setResult({
              svg: "",
              error:
                source.length > MERMAID_MAX_SOURCE
                  ? "图表源码不能超过 50000 个字符"
                  : "无法绘制图表，请切换到源码检查 Mermaid 语法。",
            });
        })
        .finally(() => {
          if (!controller.signal.aborted) setPending(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [source, theme]);
  return (
    <div className={styles.diagram} contentEditable={false} aria-busy={pending}>
      {result.svg && (
        <DiagramCanvas svg={result.svg} onExpand={() => setExpanded(true)} />
      )}
      {result.error ? (
        <p role="alert">{result.error}</p>
      ) : !result.svg ? (
        <p role="status">
          {pending ? "正在绘制图表…" : "填写 Mermaid 源码后显示图表"}
        </p>
      ) : pending ? (
        <span className={styles.updating} role="status">
          正在更新图表…
        </span>
      ) : null}
      <Modal
        title="Mermaid 图表"
        closable={{ "aria-label": "关闭全屏图表" }}
        open={expanded && Boolean(result.svg)}
        onCancel={() => setExpanded(false)}
        footer={null}
        width="100vw"
        rootClassName={styles.fullscreen}
        destroyOnHidden
      >
        <DiagramCanvas svg={result.svg} fullscreen />
        <div className={styles.fullscreenHint}>
          触控板捏合缩放 · 双指滑动移动 · Shift＋滚轮横移 · 键盘 ＋／＝／－ 缩放
          · Esc 关闭
        </div>
      </Modal>
    </div>
  );
}
