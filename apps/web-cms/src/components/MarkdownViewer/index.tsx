import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./index.module.less";

interface MarkdownViewerProps {
  content: string;
  /** 返回 true 表示调用方已处理文档跳转，阻止浏览器默认导航。 */
  onLinkClick?: (href: string) => boolean;
}

export default function MarkdownViewer({ content, onLinkClick }: MarkdownViewerProps) {
  return <article className={styles.markdown}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
      a: ({ href, children, title }) => <a href={href} title={title}
        target={href && /^(https?:)?\/\//i.test(href) ? "_blank" : undefined}
        rel={href && /^(https?:)?\/\//i.test(href) ? "noopener noreferrer" : undefined}
        onClick={event => { if (href && onLinkClick?.(href)) event.preventDefault(); }}>{children}</a>,
      table: ({ children }) => <div className={styles.tableScroll}><table>{children}</table></div>,
    }}>{content}</ReactMarkdown>
  </article>;
}
