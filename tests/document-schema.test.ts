import { expect, test } from "bun:test";
import * as Y from "yjs";
import { applyDocumentCommands } from "../apps/app_server/src/modules/collaboration/document-commands";
import {
  createDocumentState,
  documentProjection,
  normalizeDocument,
} from "../apps/app_server/src/modules/collaboration/document-schema";

test("文档权威初始化保留自定义节点、格式与稳定块ID", () => {
  const json = normalizeDocument({
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 6 },
        content: [{ type: "text", text: "标题" }],
      },
      {
        type: "callout",
        attrs: { tone: "amber", emoji: "💡" },
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "提示",
                marks: [
                  {
                    type: "textStyle",
                    attrs: { color: "#ff0000", fontSize: "20px" },
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "fold",
        attrs: { title: "折叠", open: false },
        content: [{ type: "paragraph" }],
      },
      {
        type: "image",
        attrs: {
          src: "/api/app/assets/fixture",
          assetId: "fixture",
          width: 180,
          align: "right",
        },
      },
    ],
  });
  expect(json.content?.[0]?.attrs?.blockId).toBeString();
  const doc = createDocumentState(json);
  const recovered = new Y.Doc();
  Y.applyUpdate(recovered, Y.encodeStateAsUpdate(doc));
  expect(documentProjection(recovered)).toEqual(json);
  expect(normalizeDocument(json)).toEqual(json);
  doc.destroy();
  recovered.destroy();
});
test("文档初始化拒绝不支持节点和过深正文", () => {
  expect(() =>
    normalizeDocument({ type: "doc", content: [{ type: "unknown" }] }),
  ).toThrow("不支持");
});

test("AI Markdown插入和替换解析结构并分配新稳定ID", () => {
  const doc = createDocumentState({
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { blockId: "existing" },
        content: [{ type: "text", text: "保留原文" }],
      },
    ],
  });
  try {
    applyDocumentCommands(doc, [
      {
        type: "insert_blocks",
        beforeBlockId: "existing",
        markdown:
          "## 新标题\n\n**重点**与[链接](https://example.com)\n\n- [x] 完成\n\n```typescript\nconst n = 1;\n```",
      },
    ]);
    const projection = documentProjection(doc);
    expect(projection.content?.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "taskList",
      "codeBlock",
      "paragraph",
    ]);
    expect(projection.content?.[1]?.content?.[0]?.marks?.[0]?.type).toBe(
      "bold",
    );
    expect(projection.content?.[3]?.attrs?.language).toBe("typescript");
    expect(projection.content?.[4]?.attrs?.blockId).toBe("existing");
    applyDocumentCommands(doc, [
      {
        type: "replace_block",
        blockId: "existing",
        markdown: "> 替换引用\n\n新的正文",
      },
    ]);
    const replaced = documentProjection(doc);
    expect(replaced.content?.slice(-2).map((node) => node.type)).toEqual([
      "blockquote",
      "paragraph",
    ]);
    const ids: string[] = [];
    const collect = (node: import("@tiptap/core").JSONContent) => {
      if (typeof node.attrs?.blockId === "string") ids.push(node.attrs.blockId);
      node.content?.forEach(collect);
    };
    collect(replaced);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("existing");
  } finally {
    doc.destroy();
  }
});
