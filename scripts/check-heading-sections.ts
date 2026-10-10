import assert from "node:assert/strict";
import { Schema } from "@tiptap/pm/model";
import { headingSections } from "../src/views/Document/extensions/headingSections";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { exportDocument } from "../src/views/Document/utils/markdownExport";
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: { group: "block", content: "inline*" },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 1 }, collapsed: { default: false } },
    },
    callout: { group: "block", content: "block+" },
  },
});
const heading = (text: string, level: number, collapsed = false) =>
  schema.node("heading", { level, collapsed }, schema.text(text));
const p = (text: string) => schema.node("paragraph", null, schema.text(text));
const doc = schema.node("doc", null, [
  heading("章一", 1, true),
  p("正文"),
  heading("子章", 2, true),
  p("子内容"),
  heading("章二", 1),
  p("第二章"),
  schema.node("callout", null, [heading("内部标题", 3, true), p("内部内容")]),
  heading("最后空标题", 6),
]);
const sections = headingSections(doc);
assert.equal(sections.length, 4);
const [parent, child, sibling, inside] = sections;
assert.equal(parent.contentTo, sibling.pos);
assert.ok(
  child.contentFrom >= parent.contentFrom &&
    child.contentTo <= parent.contentTo,
);
assert.equal(child.contentTo, sibling.pos);
assert.ok(inside.contentTo < doc.content.size);
assert.equal(parent.collapsed, true);
assert.equal(child.collapsed, true);
const md = new MarkdownManager({ extensions: [StarterKit] }).serialize(
  exportDocument(doc.toJSON()),
);
assert.match(md, /# 章一/);
assert.match(md, /## 子章/);
assert.match(md, /子内容/);
assert.doesNotMatch(md, /collapsed/);
console.log("章节折叠检查通过：同级边界、父子层级、容器隔离、空章节和完整导出");
