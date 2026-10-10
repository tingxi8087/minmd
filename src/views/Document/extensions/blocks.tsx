import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Popover } from "antd";
import { ChevronRight, FileText } from "lucide-react";
import { useState } from "react";
import { EmojiPicker } from "../components/InsertPicker";
import { useWorkspace } from "@/store/workspace";
function CalloutView({ node, updateAttributes }: NodeViewProps) {
  const [open, setOpen] = useState(false);
  return (
    <NodeViewWrapper className="doc-callout" data-tone={node.attrs.tone}>
      <div className="callout-controls" contentEditable={false}>
        <Popover
          trigger="click"
          placement="bottomLeft"
          open={open}
          onOpenChange={setOpen}
          content={
            <EmojiPicker
              onSelect={(emoji) => {
                updateAttributes({ emoji });
                setOpen(false);
              }}
            />
          }
          styles={{ body: { width: 320 } }}
        >
          <button
            aria-label="修改高亮块表情"
            onMouseDown={(e) => e.preventDefault()}
          >
            {node.attrs.emoji}
          </button>
        </Popover>
        <Popover
          trigger="click"
          content={
            <div className="callout-tones">
              {["mint", "blue", "amber", "rose", "neutral"].map((tone) => (
                <button
                  key={tone}
                  aria-label={`高亮块颜色 ${{ mint: "青绿", blue: "蓝色", amber: "杏色", rose: "粉色", neutral: "灰色" }[tone]}`}
                  data-tone={tone}
                  onClick={() => updateAttributes({ tone })}
                />
              ))}
            </div>
          }
        >
          <button
            className="callout-color"
            aria-label="修改高亮块底色"
            onMouseDown={(e) => e.preventDefault()}
          >
            ●
          </button>
        </Popover>
      </div>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  );
}
function FoldView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  return (
    <NodeViewWrapper className="doc-fold">
      <div className="fold-heading" contentEditable={false}>
        <button
          aria-label={node.attrs.open ? "收起折叠块" : "展开折叠块"}
          aria-expanded={node.attrs.open}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const pos = getPos();
            const closing = node.attrs.open;
            updateAttributes({ open: !closing });
            if (closing && typeof pos === "number") {
              editor
                .chain()
                .focus()
                .setTextSelection(
                  Math.min(
                    pos + node.nodeSize + 1,
                    editor.state.doc.content.size - 1,
                  ),
                )
                .run();
            }
          }}
        >
          <ChevronRight
            size={16}
            style={{ transform: node.attrs.open ? "rotate(90deg)" : undefined }}
          />
        </button>
        <input
          aria-label="折叠块标题"
          value={node.attrs.title}
          placeholder="折叠标题"
          onChange={(e) => updateAttributes({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              updateAttributes({ open: true });
              const pos = getPos();
              if (typeof pos === "number")
                editor
                  .chain()
                  .focus()
                  .setTextSelection(pos + 2)
                  .run();
            }
          }}
        />
      </div>
      <div hidden={!node.attrs.open}>
        <NodeViewContent className="fold-body" />
      </div>
    </NodeViewWrapper>
  );
}
function ReferenceView({ node }: NodeViewProps) {
  const target = useWorkspace((s) =>
    s.files.find((f) => f.id === node.attrs.id && !f.deleted),
  );
  return (
    <NodeViewWrapper
      as="span"
      className="doc-reference"
      contentEditable={false}
    >
      <a
        href={`#/document/${encodeURIComponent(node.attrs.id)}`}
        onClick={(e) => {
          if (!target) e.preventDefault();
          else useWorkspace.getState().setSpace(target.space);
        }}
        aria-label={target ? `打开文档 ${target.name}` : "引用文档已删除"}
      >
        <FileText size={14} />
        {target?.name || node.attrs.name}
        {!target && "（已删除）"}
      </a>
    </NodeViewWrapper>
  );
}
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes: () => ({
    emoji: { default: "💡" },
    tone: { default: "mint" },
  }),
  parseHTML: () => [{ tag: "aside[data-callout]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "aside",
    mergeAttributes(HTMLAttributes, { "data-callout": "" }),
    0,
  ],
  addNodeView: () => ReactNodeViewRenderer(CalloutView),
});
export const Fold = Node.create({
  name: "fold",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes: () => ({
    title: { default: "折叠标题" },
    open: {
      default: true,
      parseHTML: (element) => element.getAttribute("data-open") !== "false",
      renderHTML: (attrs) => ({ "data-open": String(attrs.open) }),
    },
  }),
  parseHTML: () => [{ tag: "section[data-fold]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "section",
    mergeAttributes(HTMLAttributes, { "data-fold": "" }),
    0,
  ],
  addNodeView: () => ReactNodeViewRenderer(FoldView),
});
export const DocumentReference = Node.create({
  name: "documentReference",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({
    id: { default: "" },
    name: { default: "未命名文档" },
  }),
  parseHTML: () => [{ tag: "span[data-document-reference]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { "data-document-reference": "" }),
    HTMLAttributes.name,
  ],
  addNodeView: () => ReactNodeViewRenderer(ReferenceView),
});
