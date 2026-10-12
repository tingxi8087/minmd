import { ySyncPluginKey } from "y-prosemirror";
import * as Y from "yjs";
/** 同时比较state vector和删除集，避免撤销/删除后误报已持久化。 */
export function snapshotConfirmed(
  document: Y.Doc,
  epoch: number,
  packet: { epoch?: number; snapshot?: number[] },
) {
  if (packet.epoch !== epoch || !Array.isArray(packet.snapshot)) return false;
  try {
    return Y.equalSnapshots(
      Y.decodeSnapshot(new Uint8Array(packet.snapshot)),
      Y.snapshot(document),
    );
  } catch {
    return false;
  }
}

/** setEditable触发的update没有正文修改，远端同步及其派生事务也不生成个人恢复草稿。 */
export function shouldRecordDraft(
  transaction: import("@tiptap/pm/state").Transaction,
) {
  if (!transaction.docChanged) return false;
  const origin = transaction.getMeta(ySyncPluginKey);
  const appended = transaction.getMeta("appendedTransaction") as
    import("@tiptap/pm/state").Transaction | undefined;
  return (
    !origin?.isChangeOrigin &&
    !appended?.getMeta(ySyncPluginKey)?.isChangeOrigin
  );
}
