import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { Input, Tooltip } from "antd";
import type { InputRef } from "antd";
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  Search,
  X,
} from "lucide-react";
import {
  replaceDocumentMatches,
  revealSearchMatch,
  searchState,
  updateDocumentSearch,
} from "../../extensions/documentSearch";
import styles from "./index.module.less";

export type SearchPanelMode = "find" | "replace" | null;
export default function FindReplace({
  editor,
  mode,
  onModeChange,
  readonly = false,
}: {
  editor: Editor;
  mode: SearchPanelMode;
  onModeChange: (mode: SearchPanelMode) => void;
  readonly?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [state, setState] = useState(() => searchState(editor));
  const [editable, setEditable] = useState(editor.isEditable && !readonly);
  const [notice, setNotice] = useState("");
  const input = useRef<InputRef>(null);
  const open = mode !== null;
  const close = () => {
    onModeChange(null);
    editor.commands.focus();
  };
  useEffect(() => {
    const update = () => {
      setState(searchState(editor));
      setEditable(editor.isEditable && !readonly);
    };
    update();
    editor.on("transaction", update);
    editor.on("update", update);
    return () => {
      editor.off("transaction", update);
      editor.off("update", update);
    };
  }, [editor, readonly]);
  useEffect(() => {
    updateDocumentSearch(editor, { query: open ? query : "", caseSensitive });
    if (open) revealSearchMatch(editor);
    else
      editor.view.dom
        .querySelectorAll("[data-search-reveal]")
        .forEach((element) => element.removeAttribute("data-search-reveal"));
  }, [editor, open, query, caseSensitive]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus({ cursor: "all" });
  }, [open, mode]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey
      )
        return;
      const find = event.key.toLowerCase() === "f" && !event.shiftKey;
      const replace = event.key.toLowerCase() === "h" && event.shiftKey;
      if (!find && !replace) return;
      // Do not take shortcuts from unrelated dialogs rendered above the document.
      if (
        Array.from(
          document.querySelectorAll('[role="dialog"], [role="alertdialog"]'),
        ).some((dialog) => dialog.getClientRects().length > 0)
      )
        return;
      event.preventDefault();
      onModeChange(
        replace && editor.isEditable && !readonly ? "replace" : "find",
      );
      input.current?.focus({ cursor: "all" });
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [editor, onModeChange, readonly]);
  const navigate = (direction: number) => {
    const { matches, active } = searchState(editor);
    if (!matches.length) return;
    updateDocumentSearch(editor, {
      active: (active + direction + matches.length) % matches.length,
    });
    revealSearchMatch(editor);
    setNotice("");
  };
  const replace = (all: boolean) => {
    if (readonly) return;
    const count = replaceDocumentMatches(editor, replacement, all);
    setNotice(count ? `已替换 ${count} 处` : "没有可替换的匹配");
    revealSearchMatch(editor);
  };
  if (!open) return null;
  return (
    <section
      className={styles.panel}
      role="search"
      aria-label={
        mode === "replace" && editable ? "文档查找与替换" : "文档查找"
      }
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        } else if (
          event.key === "Enter" &&
          event.target instanceof HTMLInputElement
        ) {
          event.preventDefault();
          navigate(event.shiftKey ? -1 : 1);
        }
      }}
    >
      <div className={styles.row}>
        {editable ? (
          <Tooltip title={mode === "replace" ? "收起替换" : "展开替换"}>
            <button
              className="icon-button"
              aria-label={mode === "replace" ? "收起替换" : "展开替换"}
              aria-expanded={mode === "replace"}
              onClick={() =>
                onModeChange(mode === "replace" ? "find" : "replace")
              }
            >
              {mode === "replace" ? (
                <ChevronDown size={16} />
              ) : (
                <ChevronRight size={16} />
              )}
            </button>
          </Tooltip>
        ) : (
          <Search size={15} className={styles.searchIcon} />
        )}
        <Input
          ref={input}
          aria-label="查找内容"
          placeholder="查找文档内容"
          value={query}
          maxLength={1000}
          onChange={(event) => {
            setQuery(event.target.value);
            setNotice("");
          }}
        />
        <span className={styles.count} role="status" aria-label="匹配数量">
          {state.matches.length
            ? `${state.active + 1} / ${state.matches.length}`
            : "0 / 0"}
        </span>
        <Tooltip title="上一处（Shift + Enter）">
          <button
            className="icon-button"
            aria-label="上一处匹配"
            disabled={!state.matches.length}
            onClick={() => navigate(-1)}
          >
            <ArrowUp size={16} />
          </button>
        </Tooltip>
        <Tooltip title="下一处（Enter）">
          <button
            className="icon-button"
            aria-label="下一处匹配"
            disabled={!state.matches.length}
            onClick={() => navigate(1)}
          >
            <ArrowDown size={16} />
          </button>
        </Tooltip>
        <Tooltip title="关闭（Esc）">
          <button
            className="icon-button"
            aria-label="关闭文档查找"
            onClick={close}
          >
            <X size={16} />
          </button>
        </Tooltip>
      </div>
      {mode === "replace" && editable && (
        <div className={styles.row}>
          <span className={styles.indent} />
          <Input
            aria-label="替换为"
            placeholder="替换为（留空即删除）"
            value={replacement}
            maxLength={10000}
            onChange={(event) => setReplacement(event.target.value)}
          />
          <button
            className="secondary-button"
            disabled={!state.matches.length}
            onClick={() => replace(false)}
          >
            替换
          </button>
          <button
            className="secondary-button"
            disabled={!state.matches.length}
            onClick={() => replace(true)}
          >
            全部替换
          </button>
        </div>
      )}
      <div className={styles.footer}>
        <button
          className={styles.caseButton}
          aria-label="区分大小写"
          aria-pressed={caseSensitive}
          onClick={() => setCaseSensitive((value) => !value)}
        >
          <CaseSensitive size={15} />
          区分大小写
        </button>
        <span role="status">
          {notice ||
            (query && !state.matches.length
              ? "未找到匹配内容"
              : "Enter 下一处 · Shift + Enter 上一处")}
        </span>
      </div>
    </section>
  );
}
