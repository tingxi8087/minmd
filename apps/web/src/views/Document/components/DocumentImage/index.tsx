import { useEffect, useRef, useState } from "react";
import { Image as PreviewImage } from "antd";
import Image from "@tiptap/extension-image";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Maximize2,
  RotateCcw,
} from "lucide-react";
import TooltipButton from "@/components/TooltipButton";
import styles from "./index.module.less";
type Size = { width: number; height: number };
type Drag = {
  x: number;
  y: number;
  verticalSign: number;
  width: number;
  ratio: number;
  sign: number;
  min: number;
  max: number;
  pointer: number;
};
function ImageView({
  node,
  selected,
  editor,
  getPos,
  updateAttributes,
}: NodeViewProps) {
  const image = useRef<HTMLImageElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const draftRef = useRef<Size | null>(null);
  const [draft, setDraft] = useState<Size | null>(null);
  const [preview, setPreview] = useState(false);
  const cancel = () => {
    drag.current = null;
    draftRef.current = null;
    setDraft(null);
  };
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drag.current) {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, []);
  const select = () => {
    const pos = getPos();
    if (typeof pos === "number")
      editor.chain().focus().setNodeSelection(pos).run();
  };
  return (
    <NodeViewWrapper
      className={`${styles.imageNode} ${selected ? styles.selected : ""}`}
      data-align={node.attrs.align || "left"}
      contentEditable={false}
    >
      <div
        ref={frame}
        className={styles.frame}
        style={{ width: draft?.width || node.attrs.width || undefined }}
      >
        <img
          ref={image}
          data-document-image=""
          data-drag-handle=""
          src={node.attrs.src}
          alt={node.attrs.alt || ""}
          title={node.attrs.title || undefined}
          width={draft?.width || node.attrs.width || undefined}
          height={draft?.height || node.attrs.height || undefined}
          onClick={select}
          onDoubleClick={(e) => {
            e.preventDefault();
            select();
            setPreview(true);
          }}
        />
        {selected && (
          <>
            <div className={styles.tools}>
              {[
                { value: "left", label: "图片左对齐", Icon: AlignLeft },
                { value: "center", label: "图片居中", Icon: AlignCenter },
                { value: "right", label: "图片右对齐", Icon: AlignRight },
              ].map(({ value, label, Icon }) => (
                <TooltipButton
                  key={value}
                  aria-label={label}
                  aria-pressed={(node.attrs.align || "left") === value}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => updateAttributes({ align: value })}
                >
                  <Icon size={14} />
                </TooltipButton>
              ))}
              <span className={styles.divider} />
              <TooltipButton
                aria-label="放大查看图片"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setPreview(true)}
              >
                <Maximize2 size={14} />
              </TooltipButton>
              <TooltipButton
                aria-label="恢复图片原始大小"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => updateAttributes({ width: null, height: null })}
              >
                <RotateCcw size={14} />
              </TooltipButton>
            </div>
            {["top-left", "top-right", "bottom-left", "bottom-right"].map(
              (corner) => (
                <button
                  key={corner}
                  type="button"
                  data-image-handle={corner}
                  className={styles.handle}
                  aria-label={`调整图片大小 ${corner}`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    select();
                    const rect = image.current!.getBoundingClientRect();
                    if (!rect.width || !rect.height) return;
                    const ratio = rect.width / rect.height;
                    const max =
                      frame.current!.parentElement!.parentElement!.clientWidth;
                    drag.current = {
                      x: e.clientX,
                      y: e.clientY,
                      verticalSign: corner.startsWith("top") ? -1 : 1,
                      width: rect.width,
                      ratio,
                      sign: corner.endsWith("left") ? -1 : 1,
                      min: Math.min(max, Math.max(48, 32 * ratio)),
                      max,
                      pointer: e.pointerId,
                    };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    const current = drag.current;
                    if (!current || current.pointer !== e.pointerId) return;
                    const horizontal = (e.clientX - current.x) * current.sign;
                    const vertical =
                      (e.clientY - current.y) *
                      current.verticalSign *
                      current.ratio;
                    const delta =
                      Math.abs(horizontal) >= Math.abs(vertical)
                        ? horizontal
                        : vertical;
                    const width = Math.round(
                      Math.max(
                        current.min,
                        Math.min(current.max, current.width + delta),
                      ),
                    );
                    const next = {
                      width,
                      height: Math.round(width / current.ratio),
                    };
                    draftRef.current = next;
                    setDraft(next);
                  }}
                  onPointerUp={(e) => {
                    if (!drag.current || drag.current.pointer !== e.pointerId)
                      return;
                    const size = draftRef.current;
                    if (e.currentTarget.hasPointerCapture(e.pointerId))
                      e.currentTarget.releasePointerCapture(e.pointerId);
                    cancel();
                    if (size) updateAttributes(size);
                  }}
                  onPointerCancel={cancel}
                />
              ),
            )}
          </>
        )}
      </div>
      <PreviewImage
        src={node.attrs.src}
        alt={node.attrs.alt || ""}
        wrapperStyle={{ display: "none" }}
        preview={{ visible: preview, onVisibleChange: setPreview }}
      />
    </NodeViewWrapper>
  );
}
export const DocumentImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      assetId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-asset-id"),
        renderHTML: (attrs) =>
          attrs.assetId ? { "data-asset-id": attrs.assetId } : {},
      },
      align: {
        default: "left",
        parseHTML: (element) => {
          const align = element.getAttribute("data-align");
          return align === "center" || align === "right" ? align : "left";
        },
        renderHTML: (attributes) => ({ "data-align": attributes.align }),
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
}).configure({ allowBase64: true });
