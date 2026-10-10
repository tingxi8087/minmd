# MarkdownViewer

用 react-markdown 与 remark-gfm 展示 Markdown，支持标题、列表、引用、表格、任务列表和代码块。组件自带局部样式，长表格和代码块横向滚动，不包含弹窗或业务文档目录。

- `content: string`：Markdown 原文。
- `onLinkClick?: (href: string) => boolean`：调用方处理本地文档跳转，返回 true 阻止默认导航。
- HTTP(S) 外部链接在新窗口打开；保留 react-markdown 默认 URL 过滤。
- 忽略原始 HTML，不启用 HTML 解析或代码高亮插件。

首页通过本地 raw 导入读取文档，并将已登记的相对文档链接解析为弹窗内切换。
