import { useState } from "react";
import { Select } from "antd";
import CodeBlock from "@tiptap/extension-code-block";
import {
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import styles from "./index.module.less";
const languages = [
  ["", "纯文本"],
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
function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const [search, setSearch] = useState("");
  const language = String(node.attrs.language || "");
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
            updateAttributes({ language: value || null });
            setSearch("");
            editor.commands.focus();
          }}
          onOpenChange={(open) => {
            if (!open) setSearch("");
          }}
        />
      </div>
      <pre>
        <NodeViewContent<"code"> as="code" style={{ whiteSpace: "pre" }} />
      </pre>
    </NodeViewWrapper>
  );
}
export const SelectableCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});
