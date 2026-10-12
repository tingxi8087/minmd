import * as Y from "yjs";
import type { JSONContent } from "@tiptap/core";
import { AppError } from "../../../../../system/server/src/errors";
import { parseMarkdownBlocks } from "./document-markdown";
import {
  createDocumentState,
  documentProjection,
  normalizeDocument,
} from "./document-schema";
type BlockInput =
  | { blocks: JSONContent[]; markdown?: never }
  | { markdown: string; blocks?: never };
export type DocumentCommand =
  | { type: "replace_text"; blockId: string; oldText: string; newText: string }
  | ({
      type: "insert_blocks";
      parentBlockId?: string | null;
      beforeBlockId?: string;
    } & BlockInput)
  | ({ type: "replace_block"; blockId: string } & BlockInput)
  | { type: "delete_block"; blockId: string }
  | {
      type: "set_block_type";
      blockId: string;
      nodeType: string;
      attrs?: Record<string, unknown>;
    };
const cloneNode = (node: Y.XmlElement | Y.XmlText | Y.XmlHook) => {
  if (node instanceof Y.XmlElement || node instanceof Y.XmlText)
    return node.clone();
  throw new AppError("CONTENT_INVALID", "文档包含未知的XML节点", 400);
};
type Block = {
  node: Y.XmlElement;
  parent: Y.XmlFragment | Y.XmlElement;
  index: number;
};
function findBlock(root: Y.XmlFragment, id: string): Block {
  const matches: Block[] = [];
  const walk = (parent: Y.XmlFragment | Y.XmlElement) => {
    parent.toArray().forEach((node, index) => {
      if (node instanceof Y.XmlElement) {
        if (node.getAttribute("blockId") === id)
          matches.push({ node, parent, index });
        walk(node);
      }
    });
  };
  walk(root);
  if (matches.length !== 1)
    throw new AppError(
      "BLOCK_TARGET_INVALID",
      matches.length ? "块ID重复，无法定位" : "目标块不存在",
      409,
    );
  return matches[0]!;
}
function freshBlocks(input: BlockInput) {
  if ((input.blocks === undefined) === (input.markdown === undefined))
    throw new AppError(
      "COMMAND_INVALID",
      "blocks与markdown必须且只能提供一项",
      400,
    );
  const blocks =
    input.markdown !== undefined
      ? parseMarkdownBlocks(input.markdown)
      : input.blocks!;
  if (!blocks.length || blocks.length > 100)
    throw new AppError("COMMAND_INVALID", "每次块插入数量为1–100", 400);
  const clean = structuredClone(blocks);
  const clear = (node: JSONContent) => {
    if (node.attrs) delete node.attrs.blockId;
    node.content?.forEach(clear);
  };
  clean.forEach(clear);
  const doc = createDocumentState({ type: "doc", content: clean });
  try {
    return doc.getXmlFragment("default").toArray().map(cloneNode);
  } finally {
    doc.destroy();
  }
}
/** 仅修改指定Yjs块，保留未指定文本格式；全部命令在候选文档中验证。 */
export function applyDocumentCommands(doc: Y.Doc, commands: DocumentCommand[]) {
  if (!commands.length || commands.length > 100)
    throw new AppError("COMMAND_INVALID", "命令数量为1–100", 400);
  const root = doc.getXmlFragment("default");
  const touched = new Set<string>();
  doc.transact(() => {
    for (const command of commands) {
      if (command.type === "insert_blocks") {
        const parent = command.parentBlockId
          ? findBlock(root, command.parentBlockId).node
          : root;
        const before = command.beforeBlockId
          ? findBlock(root, command.beforeBlockId)
          : undefined;
        if (before && before.parent !== parent)
          throw new AppError(
            "BLOCK_TARGET_INVALID",
            "定位块不是目标容器内的直接子块",
            409,
          );
        const blocks = freshBlocks(command);
        parent.insert(before?.index ?? parent.length, blocks);
        for (const block of blocks)
          if (block instanceof Y.XmlElement) {
            const id = block.getAttribute("blockId");
            if (typeof id === "string") touched.add(id);
          }
        continue;
      }
      const target = findBlock(root, command.blockId);
      touched.add(command.blockId);
      if (command.type === "delete_block") {
        target.parent.delete(target.index, 1);
        continue;
      }
      if (command.type === "replace_block") {
        target.parent.delete(target.index, 1);
        target.parent.insert(target.index, freshBlocks(command));
        continue;
      }
      if (command.type === "set_block_type") {
        const projection = documentProjection(doc);
        let original: JSONContent | undefined;
        const find = (node: JSONContent) => {
          if (node.attrs?.blockId === command.blockId) original = node;
          node.content?.forEach(find);
        };
        find(projection);
        if (!original)
          throw new AppError("BLOCK_TARGET_INVALID", "无法读取块内容", 409);
        const temp = createDocumentState({
          type: "doc",
          content: [
            {
              ...original,
              type: command.nodeType,
              attrs: {
                ...original.attrs,
                ...command.attrs,
                blockId: command.blockId,
              },
            },
          ],
        });
        let replacement: Y.XmlElement | Y.XmlText;
        try {
          const node = temp.getXmlFragment("default").get(0);
          if (!(node instanceof Y.XmlElement))
            throw new AppError("BLOCK_TARGET_INVALID", "目标类型不是块", 400);
          replacement = node.clone();
        } finally {
          temp.destroy();
        }
        target.parent.delete(target.index, 1);
        target.parent.insert(target.index, [replacement]);
        continue;
      }
      if (!command.oldText)
        throw new AppError("TEXT_TARGET_INVALID", "待替换旧文字不能为空", 400);
      const parts: { node: Y.XmlText; start: number; length: number }[] = [];
      let plain = "";
      const collect = (node: Y.XmlElement) => {
        for (const child of node.toArray()) {
          if (child instanceof Y.XmlText) {
            const text = child
              .toDelta()
              .map((delta: { insert: unknown }) =>
                typeof delta.insert === "string" ? delta.insert : "",
              )
              .join("");
            parts.push({
              node: child,
              start: plain.length,
              length: text.length,
            });
            plain += text;
          } else if (child instanceof Y.XmlElement) collect(child);
        }
      };
      collect(target.node);
      const at = plain.indexOf(command.oldText);
      if (at < 0 || plain.indexOf(command.oldText, at + 1) >= 0)
        throw new AppError(
          "TEXT_TARGET_INVALID",
          at < 0 ? "旧文字与当前块不匹配" : "旧文字存在多个匹配，无法准确定位",
          409,
        );
      const end = at + command.oldText.length;
      const anchor = parts.find(
        (part) => at >= part.start && at < part.start + part.length,
      );
      if (!anchor)
        throw new AppError("TEXT_TARGET_INVALID", "旧文字无法定位", 409);
      let offset = 0;
      let formatting: Record<string, unknown> | undefined;
      for (const delta of anchor.node.toDelta()) {
        const length =
          typeof delta.insert === "string" ? delta.insert.length : 0;
        if (
          at - anchor.start >= offset &&
          at - anchor.start < offset + length
        ) {
          formatting = delta.attributes as Record<string, unknown> | undefined;
          break;
        }
        offset += length;
      }
      for (const part of [...parts].reverse()) {
        const from = Math.max(at, part.start),
          to = Math.min(end, part.start + part.length);
        if (to > from) part.node.delete(from - part.start, to - from);
      }
      anchor.node.insert(at - anchor.start, command.newText, formatting);
    }
  });
  normalizeDocument(documentProjection(doc));
  return [...touched];
}
