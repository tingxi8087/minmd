import { useMemberNames } from "@/hooks/useMemberNames";
import { useEffect, useState } from "react";
import { Drawer, Input, Modal, App } from "antd";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { DocumentImage } from "../DocumentImage";
import { SelectableCodeBlock } from "../CodeBlock";
import {
  TextStyle,
  Color,
  BackgroundColor,
  FontSize,
} from "@tiptap/extension-text-style";
import { documentApi, type DocumentVersion } from "@/api/documents";
import { errorMessage } from "@/http";
import type { Entry } from "@/store/workspace";
import { Callout, Fold, DocumentReference } from "../../extensions/blocks";
import { BlockId } from "../../extensions/blockId";
import styles from "./index.module.less";
import { Search } from "lucide-react";
import FindReplace, { type SearchPanelMode } from "../FindReplace";
import { DocumentSearch } from "../../extensions/documentSearch";
const sourceNames: Record<string, string> = {
  manual: "手动保存",
  auto: "自动保存",
  import: "导入",
  restore: "恢复",
  ai: "AI 修改",
  initial: "初始版本",
  "before-replace": "替换前自动备份",
};
export function ReadonlyPreview({
  projection,
  label = "历史版本只读预览",
}: {
  projection: JSONContent;
  label?: string;
}) {
  const [searchMode, setSearchMode] = useState<SearchPanelMode>(null);
  const searchable = ["文档只读预览", "公开文档只读正文"].includes(label);
  const editor = useEditor({
    editable: false,
    content: projection,
    extensions: [
      StarterKit.configure({ undoRedo: false, codeBlock: false }),
      SelectableCodeBlock,
      DocumentSearch,
      TableKit.configure({ table: { resizable: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      DocumentImage.extend({ addNodeView: () => null }),
      TextStyle,
      Color,
      BackgroundColor,
      FontSize,
      BlockId.configure({ assign: false }),
      Callout.extend({
        addNodeView: () => null,
        renderHTML: ({ node, HTMLAttributes }) => [
          "aside",
          { ...HTMLAttributes, "data-callout": "" },
          ["span", { "aria-hidden": "true" }, String(node.attrs.emoji || "💡")],
          ["div", {}, 0],
        ],
      }),
      Fold.extend({
        addNodeView: () => null,
        renderHTML: ({ node, HTMLAttributes }) => [
          "section",
          { ...HTMLAttributes, "data-fold": "" },
          ["strong", {}, String(node.attrs.title || "折叠标题")],
          ["div", {}, 0],
        ],
      }),
      DocumentReference.extend({ addNodeView: () => null }),
    ],
    editorProps: { attributes: { "aria-label": label } },
  });
  return (
    <div className={styles.preview}>
      {searchable && editor && (
        <>
          <div className={styles.previewTools}>
            <button
              className={`secondary-button ${styles.findButton}`}
              onClick={() => setSearchMode("find")}
              aria-label="查找文档内容"
            >
              <Search size={14} />
              查找
            </button>
          </div>
          <FindReplace
            editor={editor}
            mode={searchMode}
            onModeChange={setSearchMode}
            readonly
          />
        </>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
export default function VersionHistory({
  file,
  open,
  close,
  onRestore,
  checkpoint,
  checkpointBusy,
}: {
  file: Entry;
  open: boolean;
  close: () => void;
  onRestore: () => void;
  checkpoint: () => Promise<void>;
  checkpointBusy: boolean;
}) {
  const { message, modal } = App.useApp();
  const actorName = useMemberNames(file.space, open);
  const [items, setItems] = useState<DocumentVersion[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<DocumentVersion | null>(null);
  const [projection, setProjection] = useState<JSONContent | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    void documentApi
      .versions(file.id, page)
      .then((result) => {
        if (active) {
          setItems(result.items);
          setTotal(result.total);
        }
      })
      .catch((error: unknown) => {
        if (active) setError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, file.id, page, reload]);
  useEffect(() => {
    if (!selected) {
      setProjection(null);
      return;
    }
    let active = true;
    setProjection(null);
    setNote(selected.note);
    void documentApi
      .version(file.id, selected.id)
      .then((result) => {
        if (active) setProjection(result.projection);
      })
      .catch((error: unknown) => {
        if (active) message.error(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [selected?.id, file.id]);
  return (
    <>
      <Drawer
        title="版本历史"
        open={open}
        width={340}
        onClose={close}
        extra={
          <button
            className="secondary-button"
            disabled={checkpointBusy}
            onClick={() => {
              void checkpoint().then(() => setReload((value) => value + 1));
            }}
          >
            保存版本
          </button>
        }
      >
        <p>最多保留最近 100 个历史版本，超出后自动清理最旧版本。</p>
        {loading && <p role="status">正在加载版本…</p>}
        {error && (
          <p role="alert">
            {error}
            <button
              className="secondary-button"
              onClick={() => setReload(reload + 1)}
            >
              重试
            </button>
          </p>
        )}
        <div className={styles.list}>
          {items.map((version) => (
            <button
              key={version.id}
              className={styles.version}
              onClick={() => setSelected(version)}
            >
              <strong>
                {version.note || sourceNames[version.source] || version.source}
              </strong>
              <span>
                {new Date(version.createdAt).toLocaleString("zh-CN")} ·{" "}
                {actorName(version.actorId)}
              </span>
              <span>
                修订 {version.revision} ·{" "}
                {sourceNames[version.source] || version.source}
              </span>
            </button>
          ))}
        </div>
        {!loading && !error && !items.length && <p>还没有历史版本</p>}
        {total > 30 && (
          <div className={styles.pages}>
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              上一页
            </button>
            <span>{page}</span>
            <button
              disabled={page * 30 >= total}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </div>
        )}
      </Drawer>
      <Modal
        title="历史版本 · 只读预览"
        open={Boolean(selected)}
        onCancel={() => {
          if (!busy) setSelected(null);
        }}
        width={840}
        footer={null}
      >
        {selected && (
          <>
            <div className={styles.actions}>
              <Input
                readOnly={selected.source !== "manual"}
                aria-label="版本备注"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={200}
                placeholder="版本备注"
              />
              <button
                className="secondary-button"
                disabled={busy || selected.source !== "manual"}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await documentApi.note(file.id, selected.id, note);
                    setReload(reload + 1);
                    message.success("备注已保存");
                  } catch (error) {
                    message.error(errorMessage(error));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                保存备注
              </button>
              <button
                className="primary-button"
                disabled={busy || !projection}
                onClick={() =>
                  modal.confirm({
                    title: "恢复这个历史版本？",
                    content:
                      "恢复会保存当前正文作为版本，并创建新协作 epoch。所有在线会话会重新打开，旧草稿不会自动合并。",
                    okText: "恢复",
                    cancelText: "取消",
                    onOk: async () => {
                      setBusy(true);
                      try {
                        const current = await documentApi.content(file.id);
                        await documentApi.restore(
                          file.id,
                          selected.id,
                          current.revision,
                          current.epoch,
                        );
                        setSelected(null);
                        close();
                        onRestore();
                        message.success("历史版本已恢复");
                      } catch (error) {
                        message.error(errorMessage(error));
                        throw error;
                      } finally {
                        setBusy(false);
                      }
                    },
                  })
                }
              >
                恢复此版本
              </button>
            </div>
            {projection ? (
              <ReadonlyPreview key={selected.id} projection={projection} />
            ) : (
              <p role="status">正在加载预览…</p>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
