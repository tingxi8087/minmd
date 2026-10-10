import assert from "node:assert/strict";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import {
  TextStyle,
  Color,
  FontSize,
  BackgroundColor,
} from "@tiptap/extension-text-style";
import {
  hasCustomTextStyle,
  withoutTextStyles,
} from "../src/views/Document/utils/markdownExport";
const doc = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "标题" }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "彩色粗体",
          marks: [
            { type: "bold" },
            {
              type: "textStyle",
              attrs: { color: "#ff0000", fontSize: "24px" },
            },
          ],
        },
      ],
    },
  ],
};
const before = JSON.stringify(doc);
assert.equal(hasCustomTextStyle(doc), true);
const stripped = withoutTextStyles(doc);
assert.equal(hasCustomTextStyle(stripped), false);
assert.equal(JSON.stringify(doc), before);
const manager = new MarkdownManager({
  extensions: [StarterKit, TextStyle, Color, FontSize, BackgroundColor],
});
const md = manager.serialize(stripped);
assert.match(md, /### 标题/);
assert.match(md, /\*\*彩色粗体\*\*/);
assert.doesNotMatch(md, /span|style|font-size|#ff0000/);
assert.equal(
  hasCustomTextStyle({
    type: "text",
    text: "默认",
    marks: [{ type: "textStyle", attrs: { color: null, fontSize: null } }],
  }),
  false,
);
console.log("Markdown 导出检查通过：样式检测、嵌套内容、标准格式与原文保护");

const { exportDocument } =
  await import("../src/views/Document/utils/markdownExport");
const rich = {
  type: "doc",
  content: [
    {
      type: "callout",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "提示 💡" }] },
      ],
    },
    {
      type: "fold",
      attrs: { title: "细节", open: false },
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "折叠内容不会丢失",
              marks: [{ type: "bold" }],
            },
          ],
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "documentReference",
          attrs: { id: "doc-start", name: "开始文档" },
        },
      ],
    },
  ],
};
const richBefore = JSON.stringify(rich);
const result = manager.serialize(exportDocument(rich));
assert.match(result, /> 提示 💡/);
assert.match(result, /### 细节/);
assert.match(result, /\*\*折叠内容不会丢失\*\*/);
assert.match(result, /\[开始文档\]\(.*#\/document\/doc-start\)/);
assert.equal(JSON.stringify(rich), richBefore);
console.log("新增内容导出通过：高亮引用、折叠展开、文档链接、Emoji 与原文保护");

const backgroundOnly = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "背景测试",
          marks: [
            { type: "bold" },
            { type: "textStyle", attrs: { backgroundColor: "#fff5a3" } },
          ],
        },
      ],
    },
  ],
};
assert.equal(hasCustomTextStyle(backgroundOnly), true);
assert.equal(hasCustomTextStyle(withoutTextStyles(backgroundOnly)), false);
assert.equal(manager.serialize(exportDocument(backgroundOnly)), "**背景测试**");
assert.equal(
  backgroundOnly.content[0].content[0].marks[1].attrs?.backgroundColor,
  "#fff5a3",
);
console.log("文字背景色导出检查通过：独立检测、样式移除、其他格式与原文保留");
