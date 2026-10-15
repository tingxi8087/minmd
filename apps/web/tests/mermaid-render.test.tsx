import { expect, it } from "vitest";
import {
  renderMermaid,
  sanitizeDiagram,
} from "../src/components/MermaidDiagram/render";
it("SVG 清理阻止脚本、HTML、外部图片、链接与外部 CSS 地址，保留内部 marker", async () => {
  const svg = await sanitizeDiagram(
    `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><foreignObject><div>html</div></foreignObject><image href="https://example.com/a.png"/><a href="https://example.com"><text>link</text></a><style>.x{fill:url(https://example.com/a)} .y{marker-end:url(#arrow)}</style><path style="marker-end:url(#arrow)"/><text>正常文字</text></svg>`,
  );
  expect(svg).not.toMatch(/script|foreignObject|<image|<a\s|onload|https:\/\//);
  expect(svg).toContain("url(#arrow)");
  expect(svg).toContain("正常文字");
});
it("真实 Mermaid 引擎可绘制流程图；无效语法不污染后续渲染且临时容器清理", async () => {
  // jsdom 无 SVG 文本测量，这里只验证引擎接线与输出，不替代浏览器视觉验收。
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 100, height: 20 }),
  });
  Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
    configurable: true,
    value: () => 100,
  });
  const before = document.body.childElementCount;
  await expect(renderMermaid("this is invalid", "light")).rejects.toThrow();
  const svg = await renderMermaid("graph TD\n A[开始] --> B[结束]", "light");
  expect(svg).toContain("开始");
  expect(svg).toContain("结束");
  expect(svg).toContain('role="img"');
  expect(document.body.childElementCount).toBe(before);
  await expect(renderMermaid("x".repeat(50_001), "light")).rejects.toThrow(
    "50000",
  );
}, 20000);
