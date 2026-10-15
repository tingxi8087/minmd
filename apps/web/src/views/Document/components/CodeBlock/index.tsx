import MermaidDiagram from "@/components/MermaidDiagram";
import { useEffect, useState } from "react";
import { Select } from "antd";
import { Trash2 } from "lucide-react";
import TooltipButton from "@/components/TooltipButton";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { codeHighlighter } from "./highlighting";
import {
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
  useEditorState,
  type NodeViewProps,
} from "@tiptap/react";
import styles from "./index.module.less";
const languages = [
  ["", "纯文本"],
  ["mermaid", "Mermaid 图表"],
  ["javascript", "JavaScript"],
  ["typescript", "TypeScript"],
  ["jsx", "JSX"],
  ["tsx", "TSX"],
  ["html", "HTML"],
  ["css", "CSS"],
  ["less", "Less"],
  ["json", "JSON"],
  ["python", "Python"],
  ["java", "Java"],
  ["go", "Go"],
  ["rust", "Rust"],
  ["cpp", "C++"],
  ["c", "C"],
  ["csharp", "C#"],
  ["php", "PHP"],
  ["ruby", "Ruby"],
  ["swift", "Swift"],
  ["kotlin", "Kotlin"],
  ["sql", "SQL"],
  ["bash", "Bash"],
  ["yaml", "YAML"],
  ["markdown", "Markdown"],
  ["dockerfile", "Dockerfile"],
  ["xml", "XML"],
].map(([value, label]) => ({ value, label }));
function CodeBlockView({
  node,
  updateAttributes,
  editor,
  deleteNode,
}: NodeViewProps) {
  const editable = useEditorState({
    editor,
    selector: ({ editor }) => editor.isEditable,
  });
  const [search, setSearch] = useState("");
  const language = String(node.attrs.language || "");
  const isMermaid = language.trim().toLowerCase() === "mermaid";
  const [view, setView] = useState<"graph" | "source">("graph");
  useEffect(() => setView("graph"), [isMermaid]);
  const custom = search.trim();
  const options = [...languages];
  if (language && !options.some((option) => option.value === language))
    options.push({ value: language, label: language });
  if (
    /^[a-zA-Z0-9_+.#-]{1,40}$/.test(custom) &&
    !options.some(
      (option) => option.value.toLowerCase() === custom.toLowerCase(),
    )
  )
    options.push({ value: custom, label: `使用自定义类型：${custom}` });
  return (
    <NodeViewWrapper className={styles.block}>
      <div className={styles.header} contentEditable={false}>
        {editable ? (
          <Select
            aria-label="代码块语言"
            size="small"
            variant="borderless"
            showSearch
            value={language}
            searchValue={search}
            onSearch={setSearch}
            options={options}
            optionFilterProp="label"
            placeholder="选择或输入类型"
            popupMatchSelectWidth={240}
            notFoundContent="输入类型名称，如 mermaid"
            onChange={(value) => {
              if (!editor.isEditable) return;
              updateAttributes({ language: value || null });
              setSearch("");
              editor.commands.focus();
            }}
            onOpenChange={(open) => {
              if (!open) setSearch("");
            }}
          />
        ) : (
          <span className={styles.language}>{language || "纯文本"}</span>
        )}
        {isMermaid && (
          <div className={styles.views} role="group" aria-label="Mermaid 视图">
            <button
              type="button"
              aria-pressed={view === "graph"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setView("graph")}
            >
              图表
            </button>
            <button
              type="button"
              aria-pressed={view === "source"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setView("source")}
            >
              源码
            </button>
          </div>
        )}
        {editable && (
          <TooltipButton
            className={styles.deleteButton}
            aria-label="删除代码块"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (!editor.isEditable) return;
              deleteNode();
              editor.commands.focus(undefined, { scrollIntoView: false });
            }}
          >
            <Trash2 size={14} />
          </TooltipButton>
        )}
      </div>
      {isMermaid && view === "graph" && (
        <MermaidDiagram source={node.textContent} />
      )}
      <pre
        className={
          isMermaid && view === "graph" ? styles.hiddenSource : undefined
        }
      >
        <NodeViewContent<"code"> as="code" style={{ whiteSpace: "pre" }} />
      </pre>
    </NodeViewWrapper>
  );
}
export const SelectableCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
}).configure({ lowlight: codeHighlighter, defaultLanguage: "plaintext" });
