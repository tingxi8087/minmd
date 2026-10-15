import { v4 as createId } from "uuid";
import type { MermaidConfig } from "mermaid";
export const MERMAID_MAX_SOURCE = 50_000;
let rendering: Promise<void> = Promise.resolve();

function safeCss(css: string) {
  if (css.includes("\\")) return "";
  return css
    .replace(/@import[^;]*(;|$)/gi, "")
    .replace(/url\s*\(([^)]*)\)/gi, (_match, raw: string) => {
      const reference = raw.trim().replace(/^['"]|['"]$/g, "");
      return /^#[\w:.-]+$/.test(reference) ? `url(${reference})` : "none";
    });
}
/** Mermaid 输出仍经过 SVG 白名单清理，图表不承载链接、HTML 或外部图片。 */
export async function sanitizeDiagram(svg: string) {
  const { default: createDOMPurify } = await import("dompurify");
  const clean = createDOMPurify(window).sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [
      "script",
      "foreignObject",
      "a",
      "image",
      "iframe",
      "object",
      "embed",
      "link",
    ],
  });
  const parsed = new DOMParser().parseFromString(clean, "image/svg+xml");
  const root = parsed.documentElement;
  if (root.localName !== "svg" || parsed.querySelector("parsererror"))
    throw new Error("图表输出无效");
  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const attr of [...element.attributes]) {
      if (attr.localName === "href" && !/^#[\w:.-]+$/.test(attr.value))
        element.removeAttributeNode(attr);
      if (/^on/i.test(attr.name)) element.removeAttributeNode(attr);
    }
    if (element.hasAttribute("style"))
      element.setAttribute("style", safeCss(element.getAttribute("style")!));
    if (element.localName === "style")
      element.textContent = safeCss(element.textContent ?? "");
  }
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", "Mermaid 图表");
  return new XMLSerializer().serializeToString(root);
}

export function renderMermaid(
  source: string,
  theme: "light" | "dark",
  signal?: AbortSignal,
): Promise<string> {
  if (source.length > MERMAID_MAX_SOURCE)
    return Promise.reject(new Error("图表源码不能超过 50000 个字符"));
  const job = async () => {
    signal?.throwIfAborted();
    const { default: mermaid } = await import("mermaid");
    signal?.throwIfAborted();
    const config: MermaidConfig = {
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
      theme: theme === "dark" ? "dark" : "default",
      themeCSS: "",
      maxTextSize: MERMAID_MAX_SOURCE,
      maxEdges: 500,
      suppressErrorRendering: true,
      flowchart: { htmlLabels: false },
      secure: [
        "secure",
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "maxEdges",
        "suppressErrorRendering",
        "htmlLabels",
        "flowchart",
        "theme",
        "themeCSS",
        "themeVariables",
        "dompurifyConfig",
      ],
    };
    mermaid.initialize(config);
    const container = document.createElement("div");
    container.setAttribute("aria-hidden", "true");
    container.style.cssText =
      "position:absolute;left:-100000px;top:0;visibility:hidden;width:1200px;pointer-events:none";
    document.body.append(container);
    try {
      const { svg } = await mermaid.render(
        `minmd-mermaid-${createId()}`,
        source,
        container,
      );
      signal?.throwIfAborted();
      return await sanitizeDiagram(svg);
    } finally {
      container.remove();
    }
  };
  // Mermaid 配置为全局状态，串行渲染保证多个图表与主题切换互不污染。
  const task = rendering.then(job, job);
  rendering = task.then(
    () => {},
    () => {},
  );
  return task;
}
