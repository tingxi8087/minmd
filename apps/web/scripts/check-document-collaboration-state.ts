import assert from "node:assert/strict";
import * as Y from "yjs";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  snapshotConfirmed,
  shouldRecordDraft,
} from "../src/views/Document/collaborationState";
import { repairBlockIds } from "../src/views/Document/extensions/blockId";
import {
  collapseKey,
  createHeadingCollapsePlugin,
} from "../src/views/Document/extensions/headingCollapse";
const document = new Y.Doc();
const text = document.getText("test");
text.insert(0, "正文");
const saved = {
  epoch: 2,
  snapshot: Array.from(Y.encodeSnapshot(Y.snapshot(document))),
};
assert.equal(snapshotConfirmed(document, 2, saved), true);
assert.equal(
  snapshotConfirmed(document, 3, saved),
  false,
  "旧epoch不能确认新文档",
);
text.delete(0, 1);
assert.equal(
  snapshotConfirmed(document, 2, saved),
  false,
  "删除不改变statevector但必须重新持久化",
);
assert.equal(
  snapshotConfirmed(document, 2, { epoch: 2, snapshot: [255] }),
  false,
);
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { blockId: { default: null } },
    },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 1 }, blockId: { default: null } },
    },
  },
});
const original = schema.node("doc", null, [
  schema.node("heading", { blockId: "stable", level: 1 }, schema.text("标题")),
  schema.node("paragraph", { blockId: "stable" }, schema.text("正文")),
  schema.node("paragraph", null, schema.text("新块")),
]);
let state = EditorState.create({
  doc: original,
  plugins: [createHeadingCollapsePlugin("")],
});
state = state.apply(repairBlockIds(state.doc, state.tr));
const ids: string[] = [];
state.doc.descendants((node) => {
  if (node.isBlock && node.type.name !== "doc") ids.push(node.attrs.blockId);
});
assert.equal(ids[0], "stable");
assert.equal(new Set(ids).size, 3);
assert.match(ids[1], /^[a-f0-9-]{36}$/);
assert.equal(
  shouldRecordDraft(state.tr),
  false,
  "setEditable合成update不产生草稿",
);
const userEdit = state.tr.insertText("编辑", 2);
assert.equal(shouldRecordDraft(userEdit), true, "实际本地输入保留草稿");
const { ySyncPluginKey } = await import("y-prosemirror");
const remoteEdit = state.tr
  .insertText("远端", 2)
  .setMeta(ySyncPluginKey, { isChangeOrigin: true });
assert.equal(shouldRecordDraft(remoteEdit), false, "远端输入不生成个人草稿");
assert.equal(
  shouldRecordDraft(
    state.tr.insertText("修复", 2).setMeta("appendedTransaction", remoteEdit),
  ),
  false,
  "远端派生事务不生成个人草稿",
);
const before = JSON.stringify(state.doc.toJSON());
const result = state.applyTransaction(
  state.tr.setMeta(collapseKey, new Set(["stable"])),
);
assert.equal(
  JSON.stringify(result.state.doc.toJSON()),
  before,
  "个人折叠不修改共享正文",
);
assert.equal(
  result.transactions.some((tr) => tr.docChanged),
  false,
);
assert.equal(collapseKey.getState(result.state)?.has("stable"), true);
const secondUser = EditorState.create({
  doc: state.doc,
  plugins: [createHeadingCollapsePlugin("")],
});
assert.equal(
  collapseKey.getState(secondUser)?.size,
  0,
  "另一用户不继承个人章节折叠",
);
document.destroy();
console.log(
  "文档协作前台状态验证通过：删除保存确认、epoch隔离、稳定块ID去重、章节折叠不改共享内容",
);
