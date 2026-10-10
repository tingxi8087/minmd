import { useState } from "react";
import { Input, Modal } from "antd";
import { FileText, Search } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { useWorkspace } from "@/store/workspace";
import { emojiGroups, emojiNames } from "./emoji";
import styles from "./index.module.less";
export type InsertKind = "emoji" | "date" | "reference";
export function EmojiPicker({
  onSelect,
}: {
  onSelect: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("表情");
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("minmd-recent-emoji") || "[]")
        .filter((v: unknown) => typeof v === "string")
        .slice(0, 24);
    } catch {
      return [];
    }
  });
  const choose = (value: string) => {
    const next = [value, ...recent.filter((e) => e !== value)].slice(0, 24);
    setRecent(next);
    try {
      localStorage.setItem("minmd-recent-emoji", JSON.stringify(next));
    } catch {
      /* Selection still works when storage is full. */
    }
    onSelect(value);
  };
  const items = query.trim()
    ? emojiGroups.flatMap((g) =>
        g.items.filter((e) =>
          `${e} ${emojiNames[e] || ""} ${g.keywords}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        ),
      )
    : group === "最近"
      ? recent
      : emojiGroups.find((g) => g.name === group)!.items;
  return (
    <div className={styles.emojiPicker}>
      <Input
        autoFocus
        aria-label="搜索表情"
        prefix={<Search size={14} />}
        placeholder="搜索表情"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className={styles.categories}>
        {["最近", ...emojiGroups.map((g) => g.name)].map((name) => (
          <button
            key={name}
            className={group === name ? styles.active : ""}
            onClick={() => {
              setGroup(name);
              setQuery("");
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className={styles.emojiGrid}>
        {items.map((e) => (
          <button
            key={e}
            aria-label={emojiNames[e]?.split(" ")[0] || e}
            onClick={() => choose(e)}
          >
            {e}
          </button>
        ))}
      </div>
      {!items.length && <p className={styles.empty}>没有匹配的表情</p>}
    </div>
  );
}
export default function InsertPicker({
  kind,
  editor,
  fileId,
  close,
}: {
  kind: InsertKind | null;
  editor: Editor;
  fileId: string;
  close: () => void;
}) {
  const files = useWorkspace((s) => s.files);
  const space = useWorkspace((s) => s.space);
  const [query, setQuery] = useState("");
  const [date, setDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const insert = (text: string) => {
    editor.chain().focus().insertContent({ type: "text", text }).run();
    close();
  };
  const docs = files.filter(
    (f) =>
      f.space === space &&
      !f.deleted &&
      f.kind === "doc" &&
      f.id !== fileId &&
      f.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Modal
      title={
        kind === "emoji"
          ? "插入表情"
          : kind === "date"
            ? "插入日期"
            : "引用文档"
      }
      open={Boolean(kind)}
      onCancel={close}
      width={kind === "reference" ? 400 : 360}
      footer={kind === "date" ? undefined : null}
      okText="插入"
      cancelText="取消"
      onOk={() => {
        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) insert(date);
      }}
      afterClose={() => setQuery("")}
    >
      {kind === "emoji" && <EmojiPicker onSelect={insert} />}
      {kind === "date" && (
        <input
          className={styles.dateInput}
          type="date"
          aria-label="选择日期"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      )}
      {kind === "reference" && (
        <>
          <Input
            autoFocus
            prefix={<Search size={14} />}
            aria-label="搜索文档"
            placeholder="搜索当前空间文档"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className={styles.documents}>
            {docs.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  editor
                    .chain()
                    .focus()
                    .insertContent({
                      type: "documentReference",
                      attrs: { id: f.id, name: f.name },
                    })
                    .run();
                  close();
                }}
              >
                <FileText size={16} />
                <span>{f.name}</span>
              </button>
            ))}
            {!docs.length && <p className={styles.empty}>没有可引用的文档</p>}
          </div>
        </>
      )}
    </Modal>
  );
}
