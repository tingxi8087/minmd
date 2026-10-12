# 上游来源

MinMD 后端与管理后台基于 [tingxi8087/mas-backend-cli](https://github.com/tingxi8087/mas-backend-cli)。

- 引入提交：`58e02cf5e315cab4403373981b40dacc9c903b19`。
- 引入日期：2026-10-11。
- 引入内容：`system/`、`apps/app_server/`、`apps/web-cms/`、配置、迁移、脚本和测试。
- 上游许可证：MIT，保留于根目录 `LICENSE`；后台所复用的其他上游来源见 `apps/web-cms/UPSTREAM.md`。
- 本仓库整合改动：新增 `apps/web`、前台开发进程、三端构建和独立输出、配置模板及运行说明。

后续升级以此提交为基准审查差异，不直接覆盖 MinMD 业务和前台代码。未引入上游凭证、数据库、备份、运行文件或 Git 仓库。

表格编辑器使用 [FortuneSheet](https://github.com/ruilisi/fortune-sheet) 的 `@fortune-sheet/core` / `@fortune-sheet/react` 1.0.4，发布元数据声明 MIT；发布包没有独立 LICENSE，完整许可取自 npm 对应 gitHead `94346608877db4747406707a177c4b8f3bacdbf9` 的上游许可证。未引入 Univer Pro 协作扩展。`@univerjs/core` 1.0.4（Apache-2.0）仅用于旧数据 / XLSX 转换兼容。

文档协作使用 `@hocuspocus/server` / `@hocuspocus/provider` 4.7.0（MIT）、`yjs` 13.6.33（MIT）、Tiptap Collaboration / Collaboration Caret 3.31.4（MIT）。均来自 npm 正式包，验证模块自托管，不依赖托管服务或商业密钥；分发时保留对应版权和许可声明。

完整第三方版权与许可全文保存在 [THIRD_PARTY_NOTICES.txt](../THIRD_PARTY_NOTICES.txt)，由 `bun scripts/generate-third-party-notices.ts` 根据当前工作区生产依赖、已安装传递依赖、同伴与可选依赖生成。`bun scripts/generate-third-party-notices.ts --check` 校验锁文件和原始许可文本是否与通知一致；升级依赖后重新生成，缺少原许可全文的新版必须补充核实证据。逐包来源及文本哈希见 [third-party-manifest.json](licenses/third-party-manifest.json)，发布包遗漏 LICENSE 时使用 [逐版本证据](licenses/package-overrides/sources.json)，不根据常见许可推断未知许可。构建将 LICENSE 和通知复制到部署包根目录及前后台静态目录。

`buffers@0.1.1` 的发布清单没有许可字段，旧上游及声明许可的 commit 当前不可访问。保留 [Debian 同版本源包版权记录](https://sources.debian.org/data/main/n/node-buffers/0.1.1-2/debian/copyright) 原文：`Files: *` 明确列出 James Halliday 的 MIT 授权并引用上游声明 commit；`debian/*` 的打包版权与原代码版权分开保留，未将打包许可替代原代码许可。`jstat@1.9.6` 的清单无许可字段，但实际 LICENSE 为 MIT，通知按原文保留。

PPTX 渲染器自带组件的 MPL-2.0、ECMA 条款以及精确源码地址另见 [PPTX 补充通知](licenses/pptx-renderer-notices.txt)，该原文同时拼入主通知。MCP 包以各已安装发布包的原 LICENSE 为准，保留 MIT / Apache-2.0 迁移涉及的完整文本。
