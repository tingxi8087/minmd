import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type HeadingSection = {
  pos: number;
  contentFrom: number;
  contentTo: number;
  collapsed: boolean;
};
// Chapters stop at the next sibling heading with an equal or higher level.
// Walking each parent keeps headings inside a callout/fold/list local to that block.
export function headingSections(doc: ProseMirrorNode): HeadingSection[] {
  const sections: HeadingSection[] = [];
  const walk = (parent: ProseMirrorNode, start: number) => {
    const children: { node: ProseMirrorNode; pos: number }[] = [];
    parent.forEach((node, offset) =>
      children.push({ node, pos: start + offset }),
    );
    children.forEach(({ node, pos }, i) => {
      if (node.type.name === "heading") {
        let end = pos + node.nodeSize;
        for (let j = i + 1; j < children.length; j++) {
          const next = children[j];
          if (
            next.node.type.name === "heading" &&
            next.node.attrs.level <= node.attrs.level
          )
            break;
          end = next.pos + next.node.nodeSize;
        }
        if (end > pos + node.nodeSize)
          sections.push({
            pos,
            contentFrom: pos + node.nodeSize,
            contentTo: end,
            collapsed: Boolean(node.attrs.collapsed),
          });
      }
      if (!node.isLeaf) walk(node, pos + 1);
    });
  };
  walk(doc, 0);
  return sections;
}
