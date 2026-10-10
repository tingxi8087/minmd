# 上游来源

MinMD 后端与管理后台基于 [tingxi8087/mas-backend-cli](https://github.com/tingxi8087/mas-backend-cli)。

- 引入提交：`58e02cf5e315cab4403373981b40dacc9c903b19`。
- 引入日期：2026-10-11。
- 引入内容：`system/`、`apps/app_server/`、`apps/web-cms/`、配置、迁移、脚本和测试。
- 上游许可证：MIT，保留于根目录 `LICENSE`；后台所复用的其他上游来源见 `apps/web-cms/UPSTREAM.md`。
- 本仓库整合改动：新增 `apps/web`、前台开发进程、三端构建和独立输出、配置模板及运行说明。

后续升级以此提交为基准审查差异，不直接覆盖 MinMD 业务和前台代码。未引入上游凭证、数据库、备份、运行文件或 Git 仓库。
