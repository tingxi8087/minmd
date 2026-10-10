import assert from "node:assert/strict";
import { codeHighlighter } from "../src/views/Document/components/CodeBlock/highlighting";
const tokens = (
  value: ReturnType<typeof codeHighlighter.highlight>,
): string[] => {
  const result: string[] = [];
  const visit = (node: any) => {
    if (node.properties?.className) result.push(...node.properties.className);
    node.children?.forEach(visit);
  };
  visit(value);
  return result;
};
for (const language of [
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "html",
  "css",
  "less",
  "json",
  "python",
  "java",
  "go",
  "rust",
  "cpp",
  "c",
  "csharp",
  "php",
  "ruby",
  "swift",
  "kotlin",
  "sql",
  "bash",
  "yaml",
  "markdown",
  "dockerfile",
  "xml",
  "JS",
  "TSX",
  "c++",
  "c#",
])
  assert.equal(codeHighlighter.registered(language), true, language);
for (const [language, code] of [
  ["typescript", 'const message: string = "Hello"; // note'],
  ["python", 'def greet():\n    return "hello" # note'],
  ["sql", "SELECT name FROM users WHERE id = 42;"],
])
  assert.ok(
    tokens(codeHighlighter.highlight(language, code)).includes("hljs-keyword"),
    language,
  );
assert.ok(
  tokens(
    codeHighlighter.highlight("typescript", 'const message = "Hello"; // note'),
  ).includes("hljs-string"),
);
assert.ok(
  tokens(
    codeHighlighter.highlight("typescript", 'const message = "Hello"; // note'),
  ).includes("hljs-comment"),
);
assert.deepEqual(
  tokens(codeHighlighter.highlight("plaintext", 'const message = "Hello";')),
  [],
);
assert.deepEqual(
  tokens(codeHighlighter.highlight("minmd-dsl", 'const message = "Hello";')),
  [],
);
assert.deepEqual(
  tokens(codeHighlighter.highlightAuto('const message = "Hello";')),
  [],
);
console.log(
  "Code highlighting checks passed: presets, aliases, tokens, plaintext and unknown types.",
);
