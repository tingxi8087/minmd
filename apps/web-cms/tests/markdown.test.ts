import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import MarkdownViewer from "@/components/MarkdownViewer";
const render = (content: string) => {
  const node = document.createElement('div');
  node.innerHTML = renderToStaticMarkup(createElement(MarkdownViewer, { content }));
  return node;
};
it("渲染标题、列表、GFM 表格及代码块", () => {
  const node = render('# 文档\n\n- 项目\n\n| 字段 | 说明 |\n| --- | --- |\n| name | 姓名 |\n\n```ts\nconst a = 1;\n```');
  expect(node.querySelector('h1')?.textContent).toBe('文档');
  expect(node.querySelector('li')?.textContent).toBe('项目');
  expect(node.querySelectorAll('table tbody td')).toHaveLength(2);
  expect(node.querySelector('pre code')?.textContent).toContain('const a = 1');
});
it("外链安全打开，原始 HTML 与危险 URL 不执行", () => {
  const node = render('[文档](https://example.com)\n\n[危险](javascript:alert%281%29)\n\n<script>alert(1)</script>');
  expect(node.querySelector('a')?.getAttribute('target')).toBe('_blank');
  expect(node.querySelector('a')?.getAttribute('rel')).toContain('noopener');
  expect(node.querySelector('script')).toBeNull();
  expect(node.querySelector('a[href^="javascript:"]')).toBeNull();
});
