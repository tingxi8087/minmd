import type { JSONContent } from "@tiptap/core";

export function hasCustomTextStyle(node: JSONContent): boolean {
  return Boolean(
    node.marks?.some(
      (mark) =>
        mark.type === "textStyle" &&
        (mark.attrs?.color ||
          mark.attrs?.backgroundColor ||
          mark.attrs?.fontSize),
    ) || node.content?.some(hasCustomTextStyle),
  );
}

// Strip presentation marks from a copy; never change the saved rich-text document.
export function withoutTextStyles(node: JSONContent): JSONContent {
  return {
    ...node,
    ...(node.marks
      ? { marks: node.marks.filter((mark) => mark.type !== "textStyle") }
      : {}),
    ...(node.content ? { content: node.content.map(withoutTextStyles) } : {}),
  };
}

export function hasCustomBlocks(node: JSONContent): boolean {
  return (
    ["callout", "fold"].includes(node.type || "") ||
    Boolean(node.content?.some(hasCustomBlocks))
  );
}
// Normalize rich blocks to portable Markdown nodes, preserving all body content.
export function exportDocument(
  node: JSONContent,
  resolveName?: (id: string) => string | undefined,
): JSONContent {
  const stripped = withoutTextStyles(node);
  const normalize = (value: JSONContent): JSONContent => {
    if (value.type === "documentReference") {
      return {
        type: "text",
        text:
          resolveName?.(value.attrs?.id) || value.attrs?.name || "未命名文档",
        marks: [
          {
            type: "link",
            attrs: {
              href: `${typeof window === "undefined" ? "" : window.location.href.split("#")[0]}#/document/${encodeURIComponent(value.attrs?.id || "")}`,
            },
          },
        ],
      };
    }
    const content = value.content?.flatMap((child) => {
      if (child.type === "fold")
        return [
          {
            type: "heading",
            attrs: { level: 3 },
            content: [{ type: "text", text: child.attrs?.title || "折叠标题" }],
          },
          ...(child.content || []).map(normalize),
        ];
      return [normalize(child)];
    });
    if (value.type === "callout")
      return {
        type: "blockquote",
        content: content || [{ type: "paragraph" }],
      };
    return { ...value, ...(content ? { content } : {}) };
  };
  return normalize(stripped);
}
