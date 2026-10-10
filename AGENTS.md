# 开发规范

适用于整个仓库。开始工作先读 [README.md](README.md) 了解启动和目录；修改 `apps/web-cms` 时同时遵循其 [AGENTS.md](apps/web-cms/AGENTS.md)。本文件记录开发约定，源码和实际运行结果用于核实当前行为；发现文档与代码冲突时先查明原因并同步修正。用户明确的任务要求优先于本文。

## 工作方式

- 先检查当前工作区、相关实现和调用点，再修改；不要假定先前聊天中的实现仍存在。
- 用 `rg` 查找已有组件、模块与工具。优先复用，其次在已有能力上组合或扩展；不要新增平行的请求层、状态库、鉴权框架。
- 保留用户未提交的修改，不为完成任务恢复、覆盖或清理无关文件。不停止不属于本次验收的服务。
- 业务变更保持聚焦，不因统一格式、命名或“架构优化”批量重写无关代码。
- 只有可复用的基础能力才进入 `system/server`；不提前搭多层抽象，不为缩短文件机械拆分。
- 文档说明当前行为，不积累阶段计划、历史验收报告或未经验证的完成声明。

## 工具与代码

- 使用 Bun 安装依赖、执行脚本和运行后端；仅维护根目录 `bun.lock`。从根目录安装 workspace 依赖，不使用 npm、pnpm、yarn 或 cnpm 生成其他锁文件。
- 技术栈保持现有 TypeScript、Fastify、Drizzle、PostgreSQL、TypeBox、Zod。具体版本以清单和锁文件为准。
- TypeScript 使用严格模式和 ES Module，优先类型推导，类型导入使用 `import type`。不以新增 `any`、`@ts-ignore` 或关闭规则来绕过错误。
- 两空格缩进、双引号、分号；按 Prettier 配置处理，不批量格式化被 `.prettierignore` 排除的上游代码。
- 注释解释权限边界、事务约束或设计原因，不逐句复述代码；用户可见提示与接口说明使用中文。
- 新配置通过统一配置入口校验，补充 `.env.example` 中文说明、默认值、枚举或取值范围。不将 `.env`、凭证、令牌、运行日志或备份提交到 Git。

## 模块边界

- `app.config.ts` 是业务启动及 schema 入口配置，工具脚本读取它，不在各脚本重复硬编码具体业务路径。
- `apps/app_server/src/app.ts` 调用 `createApp`，传入前后台权限目录、业务角色成员统计适配和模块注册函数；`main.ts` 只调用 `startApp`。
- `register(app, { config, database })` 使用现有数据库连接。系统模块不导入 `apps/app_server` 或根目录 `config/permissions.ts`。
- `createApp` 创建实例并管理连接生命周期，不监听端口；`startApp` 负责初始化超管、监听、信号和安全错误输出。测试使用 `app.inject()`，结束调用 `app.close()`。
- 后端按业务模块组织，可使用 `index.ts`、`schemas.ts`、`service.ts`，简单模块不强制增加层级。
- 系统表放 `system/server/src/database/schema/system.ts`，业务表放 `apps/app_server/src/database/schema/`。业务导出入口由 `app.config.ts` 指定。

## 接口与数据契约

- JSON 接口使用 `/api/` 前缀。每个接口显式声明 `config.auth` 和响应 Schema；POST / PUT / PATCH 声明请求体 Schema，无内容时用空对象。
- 使用 TypeBox 定义请求及响应，优先用 `Static` 推导类型。约束长度、枚举、ID 格式、分页范围；写入对象明确限制不允许的额外字段。
- 请求契约与数据库实体分开。响应列出允许输出的字段，不返回密码哈希、令牌哈希或内部配置；自定义 JSON 仅在明确的局部字段使用 Unknown/Record。
- 路由 `tags`、`summary`、`description`、字段 `description` 使用中文；示例必须满足校验。描述写清身份、权限、数据范围及副作用，声明实际使用的状态码与响应。
- 接口目录由 OpenAPI 自动生成，不手工维护平行列表。查看 [用户接口](apps/app_server/src/modules/users/index.ts) 和 [管理接口](apps/app_server/src/modules/users/management.ts) 的实际实现。
- 分页使用 `page`、`pageSize`，默认限制每页 1–100；返回 `items`、`total`、`page`、`pageSize`，越界页码按已有管理接口处理。
- 业务错误使用 `AppError`，统一返回 `code`、`message`、`requestId`；不要泄漏原始 SQL、连接信息或异常堆栈。

## 认证与权限

- 权限定义唯一来源是 `config/permissions.ts`：`adminPermissions` 属于后台，`appPermissions` 属于前台；code 全局唯一、稳定，不以菜单文字作为权限标识。
- 后台接口使用 `auth: true`，按需声明 `permissions`（全部满足）或 `superAdmin: true`；前台接口同时声明 `authScope: "app"`，由业务前台鉴权模块处理。
- 后台身份读取 `request.identity`，前台身份读取 `request.appIdentity`。不要将两类 token、Cookie 或身份相互回退使用。
- 角色 `scope` 创建后不可修改。角色分配与权限保存必须在后端验证归属；后台管理前台用户属于后台权限，不属于前台业务权限。
- 超管是特殊身份，不能通过角色授予；保留其资料和角色限制。前端隐藏菜单、按钮只是展示，不能代替后端鉴权。
- 登录不是数据授权。个人资料及用户资源以当前身份限定查询，不信任请求提交的用户 ID、角色、状态或 metadata 中的授权字段。
- Cookie 写请求保留来源和 CSRF 校验；密码沿用现有哈希工具。停用、密码修改和强制下线沿用会话撤销机制。
- 修改权限代码后同时检查路由、菜单、按钮、测试与文档，验证未授权、跨身份和跨角色场景。

## 数据库、迁移和日志

- 修改 schema 后运行 generate，审查生成 SQL 再 migrate。`db:sync` 会直接执行两步，不适合需要先审查的目标库。
- 已应用迁移保留原文件，结构调整新增迁移；`database/migrations` 和数据库迁移记录不是可随意删除的缓存或备份。
- 不为了修复迁移报错直接清库。`db:reset` 只用于用户明确要求重置的场景，保留备份和命令行双确认。
- 参数值使用 ORM 或参数化 SQL；动态标识符必须验证并正确引用，不拼接用户输入。
- 有一致性要求的数据修改、关联变更和审计放在同一事务。角色和账号管理沿用现有共享锁，防止校验与分配之间发生竞争。
- 新表与有业务含义的字段补简短中文注释；`id`、创建/更新时间不强制重复说明。Drizzle 不生成注释时在新迁移中明确写 COMMENT。
- 管理操作通过现有审计服务记录明确白名单；不记录密码、token 或任意 metadata 副本。运行日志不记录完整请求体、凭证、查询字符串或原始数据库异常。
- 环境判断使用经过校验的服务端 `APP_ENV`，不以 Vite mode 推断。日志、调试和数据库工作台保留环境及超管边界。

## 验证与交付

根据改动选择有意义的验证，不能只改测试断言来掩盖行为错误。

| 改动                   | 必要验证                                                                |
| ---------------------- | ----------------------------------------------------------------------- |
| TypeScript / 通用逻辑  | `bun run check`，补充或更新相关行为测试                                 |
| 后台前端               | 前端 typecheck、lint；组件或 hooks 按需跑前端测试；交互变更做浏览器验收 |
| 数据库、认证、角色权限 | 独立 `_test` 数据库执行 `bun run test:integration`，检查迁移和授权边界  |
| 启动、构建或静态挂载   | 构建及对应运行测试；进程生命周期变化运行 runtime-process 测试           |
| 文档删除、入口变动     | 搜索链接和 `?raw` 引用，检查路径、命令及构建                            |

- 测试命令与环境设置见 README。普通 Bun 测试跳过数据库项目时，明确说明，不宣称集成验收通过。
- 集成测试和浏览器测试使用不同的专用库；不要在正式库或正在使用的开发库运行。自测进程用独立端口，结束后清理本次创建的进程与数据。
- 核对文档命令与 `package.json` 一致，配置与 `.env.example` 一致；公共接口变动检查旧调用方。
- 完成时报告改动结果、实际运行的检查和未解决问题，不用历史测试结果替代当前验证。
