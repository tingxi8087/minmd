# mas-cms 来源

- 仓库：https://github.com/tingxi8087/mas-cms
- 分支：main
- 提交：3e6404b4902cfa5db4bf97b1dabefe89e1b91c98
- 重新导入日期：2026-09-17

删除旧 apps/web-cms 后由此提交完整复制，排除 Git 元数据、依赖、产物、环境文件与其他锁文件。独立的本地 mas-cms 项目未修改。

保留上游布局、样式、公共组件和 hooks。开发约定与复用入口已合并到本目录 AGENTS.md，以当前项目为准。适配 Bun workspace 和 /web-cms/ 部署路径。AdminAccounts、RoleManage、RuntimeLogs、AuditLogs 已接入真实后端；上游 UserCurd 和演示代码保留但不注册路由。

列表沿用 SearchTableForm、useBasePageTable、useElementBottomDistance，表单采用 ref.open(config)，角色权限采用右侧 Drawer 和分组选择。登录、菜单及操作按钮接入真实权限。安装遵循本项目 Bun 约定，启动和验收方式见根目录 [README.md](../../README.md)。
