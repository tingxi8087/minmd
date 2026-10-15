# 开发指南

本文面向参与开发和调试的贡献者。安装部署及日常维护见 [部署与维护](../deploy/README.md)，产品介绍和使用入口见 [项目首页](../README.md)。修改前请阅读 [开发规范](../AGENTS.md)。

## 启动

要求 Bun 1.3.13+、PostgreSQL（已用 PostgreSQL 18 验证）。从仓库根目录执行：

```sh
bun install --frozen-lockfile
cp .env.example .env
```

已有 `.env` 时不要覆盖；旧配置需将 `AUTH_TRANSPORT` 设为 `cookie`，并将 `PUBLIC_ORIGIN` 和 `APP_PUBLIC_ORIGIN` 统一设为后端访问来源（默认 `http://127.0.0.1:9811`），并在启动前执行下面的迁移。填写数据库连接和首次管理员账号密码，数据库需预先创建；迁移只创建表结构。

```sh
bun run db:migrate
bun run dev
```

当前迁移基线为 `database/migrations/0000_initial.sql`，直接创建完整结构，`meta` 保存对应快照。基线沿用旧链最后一次迁移 `0013_safe_starfox` 的时间标记；已执行完旧链的数据库再次运行 `bun run db:migrate` 会跳过初始化，保留现有内容及迁移记录。尚未执行完旧链的数据库须先用原版本补齐旧迁移；新数据库直接运行当前迁移。后续结构变更继续生成增量迁移，不重复合并或更改基线时间。

统一开发入口：前台 <http://127.0.0.1:9811/>，后台 <http://127.0.0.1:9811/admin/>，接口也使用同一来源。后端仅在 `APP_ENV=development` 且 `WEB_DEV_PROXY=true` 时反代本机两个 Vite 服务；无需构建，关闭 HMR 后修改前端代码刷新页面即可。`GET /api/health` 会实际检查数据库连接。端口由 `.env` 的 `WEB_PORT`、`WEB_CMS_PORT`、`PORT` 配置，后端变更时同步修改 `API_PROXY_TARGET`。

前后台使用独立 Cookie 身份和 CSRF 校验，配置模板默认 `AUTH_TRANSPORT=cookie`。前台注册默认关闭，可由后台创建前台账号；开发前台来源由 `APP_PUBLIC_ORIGIN` 和 `APP_DEV_ORIGINS` 配置。

前台用户密码长度为 6–128 位，注册、后台创建 / 重置及用户自行修改使用同一限制。

没有前台账号且未完成初始化时，首次进入前台会显示两步向导：创建账号、设置空间名称和选填描述。提交会在同一事务中创建账号、所有者空间、可编辑的「欢迎使用 minmd」引导文档及登录会话，完成后直接打开文档；初始化不依赖公开注册开关。并发提交只允许一个初始化成功，完成标记不会随账号删除而清除。升级已有前台账号的数据库会自动标记已初始化。

后台新建前台用户默认勾选「创建默认空间」，可取消；勾选后同时创建「昵称的空间」（没有昵称则使用账号）和引导文档。编辑已有用户不提供此选项。管理接口的 `createDefaultSpace` 仅在新建时接受，省略时不创建空间，兼容已有调用方。

后台前台用户表单支持头像上传、预览、更换和移除，允许 1MB 以内的 PNG、JPEG、WebP、GIF；保存用户资料后生效。头像为公开图片，存放于私有附件目录下的 `avatars` 子目录，备份时随附件目录保留。额外 JSON 资料和前台角色能力仍由接口保留，当前用户表单不展示；编辑用户不会清空已有资料或角色分配。

可选开发数据库（需要 Docker 正常运行）：

```sh
docker compose -f deploy/compose.yaml up -d
```

此 Compose 只启动开发 PostgreSQL，默认连接与 `.env.example` 一致。生产部署由单个 app 同端口托管两个网页及接口，数据库独立运行。完整应用使用独立 [生产 Compose](../deploy/compose.production.yaml)，步骤及单实例边界见 [部署与备份恢复](../deploy/README.md)。首次管理员从 `.env` 初始化，仅在库中没有超管时生效。不要对外使用模板默认密码。

## 源码构建部署

需要开发自定义版本，或尚未发布可用 Release 时，可在完整源码目录执行：

```sh
./minmd.sh install --build
# 也可使用非交互 IP 直连
./minmd.sh install --mode direct --origin http://192.168.1.10:9811 --build --yes
```

该方式由 Docker 本地构建 app / migrate 镜像，首次安装耗时更长，不需要在宿主机安装 Bun 或 Node。可选 `proxy`、`https`、`direct`，后续维护使用同一套 `minmd.sh`；正式用户安装优先选 [一行命令或 Release 部署包](../deploy/README.md#安装)。

安装入口 `install.sh` 的行为回归可单独运行 `bun test tests/installer.test.ts`；其中管道交互测试使用开发机的 Python 3 创建真实控制终端，正式安装不依赖 Python。

## 命令和目录

| 命令                                         | 用途                                                               |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `bun run dev`                                | 同时启动前台、后台、后端；一个子服务退出时关闭其他子服务           |
| `bun run dev:web`                            | 单独启动前台                                                       |
| `bun run dev:web-cms`                        | 单独启动管理后台                                                   |
| `bun run dev:server`                         | 单独启动后端                                                       |
| `bun run build`                              | 构建 `dist/web`、`dist/web-cms`、`dist/server`                     |
| `bun run start`                              | 运行构建后的后端；预发 / 正式同端口托管前后台、API、协作和 MCP     |
| `bun run preview`                            | 预览构建后的前台（仅静态页面，不代理业务 API）                     |
| `bun run typecheck`                          | 检查后端和两个前端                                                 |
| `bun run check`                              | 类型检查、后端测试和现有前台行为检查；未指定测试库时数据库测试跳过 |
| `bun run test:integration`                   | 使用 `TEST_DATABASE_URL` 指定的专用测试库运行数据库 / 鉴权测试     |
| `bun run db:generate` / `bun run db:migrate` | 生成 / 执行数据库迁移                                              |

```text
apps/web/              MinMD 前台及编辑器
apps/web-cms/          MAS 管理后台
apps/app_server/       MinMD 业务后端及前台账号模块
system/server/         通用认证、角色权限、日志和基础服务
config/                权限及开发配置
database/migrations/  数据库迁移
scripts/               根目录开发、构建与数据库工具
apps/web/scripts/      原有前台行为检查脚本
deploy/                开发 / 生产 Compose、Dockerfile、部署说明及备份恢复
```

根目录维护唯一 `bun.lock`，各应用通过 Bun workspace 安装。前台接口使用 `/api`；开发前后台由后端统一反代，内部 Vite 端口不作为浏览器入口。后台部署路径示例为 `/admin`，修改配置后需重启后端。正式 Cookie 默认需要 HTTPS 和匹配的访问来源；无域名部署可显式选择 [IP 直连](../deploy/README.md#无域名ip-直连)，使用受限的 `HTTP_IP_DIRECT` 配置，不改变运行环境或开发调试开关。

验收命令示例：

```sh
bun run check
RUNTIME_PROCESS_TEST=true bun test tests/runtime-process.test.ts
DEV_PROCESS_DATABASE_URL=postgresql://user:password@127.0.0.1:5432/minmd_test RUNTIME_PROCESS_TEST=true bun test tests/dev-process.test.ts
bun run --cwd apps/web-cms lint
TEST_DATABASE_URL=postgresql://user:password@127.0.0.1:5432/minmd_test bun run test:integration
```

数据库测试必须使用独立 `_test` 库，不指向日常开发库或生产库。配置、运行日志、数据库文件、上传文件和临时验收截图不提交 Git；供项目首页使用的脱敏演示截图放在 `docs/images/`。`dist/.env.example` 仅为公开配置模板，不包含本机凭证。

本机设置了全局 HTTP 代理时，验收命令需在前面加 `env -u HTTPS_PROXY -u HTTP_PROXY -u ALL_PROXY`，确保本地健康检查直接连接。开发进程已对后端和 Vite 的本地代理设置 `NO_PROXY`。

## 主题与工程

`apps/web/src/theme.less` 集中定义语义颜色、文件类型颜色、字体、间距、尺寸、圆角与动效变量。`data-theme` 切换浅色 / 深色，Ant Design 配置同步读取颜色变量。样例纸张使用单独的预览色变量。

React 18、TypeScript、Vite、Hash Router、Zustand、Ant Design、Tiptap、lucide-react、Less Modules。跨模块引用使用 `@/`，页面与组件采用目录式组织。

后台账号与系统权限沿用脚手架自带管理界面，MinMD 空间元数据和成员管理已接入。后台空间管理不授予私有文档正文读取权限。

正式协作每文件默认允许 10 个编辑会话，同账号多页面分别计数。文档与表格连接入口默认每秒最多 100 条消息，可分别配置 1–1000；超限关闭连接，未确认操作保留恢复副本。表格消息和当前投影默认各最多 8 MiB，可配置 1 KiB–8 MiB；最多 30 个工作表，单表最多 10,000 行、1,000 列，同时受单表 300,000 个网格位置上限约束。XLSX 的 200 MB 文件体积限制不替代转换后工作簿的这些限制。文档权威状态与 JSON 投影各限制 8 MiB。

性能测试应记录机器配置、数据规模和网络条件；协议与数据库结果不能直接等同浏览器体验或广域网延迟。

可在独立 `_test` 数据库复验，脚本会创建并清理本次测试数据：

```sh
TEST_DATABASE_URL=postgresql://user:password@127.0.0.1:5432/minmd_test bun scripts/benchmark-document-collaboration.ts
TEST_DATABASE_URL=postgresql://user:password@127.0.0.1:5432/minmd_test bun scripts/benchmark-sheet-collaboration.ts
```

## 表格协作开发验证

设置 `SHEET_COLLAB_VERIFY_ENABLED=true` 后启动开发环境，在表格顶部点击「协作验证」。前台通过开发配置 `API_PROXY_TARGET` 对应的 WebSocket 地址连接后端。两个页面打开同一文件 ID 即进入同一房间，使用演示身份，不能代替账号或空间权限验证；正式 / 预发环境禁止开启此模块，生产前台不显示入口。

每份表格默认最多 **10 个编辑会话**，同一账号打开两个页面占两个名额。`SHEET_COLLAB_MAX_SESSIONS` 可设置 1–100，第 11 个会话被拒绝，连接关闭后释放名额。验证数据在 `SHEET_COLLAB_VERIFY_DIR`（默认 `runtime/sheet-verification`）落盘，此目录已忽略。

服务端串行提交并在落盘后广播，普通单元格冲突按服务端接收顺序处理；结构变动后的旧修订操作被拒绝。断开 / 冲突时未确认内容保留为本地恢复副本，页面可下载 XLSX，再手动重连加载权威状态。此入口是独立的演示协议，不具备正式表格房间的完整结构并发、鉴权及存储能力；正式业务验收应使用真实账号和普通表格页面。

旧 Univer 本地快照读取时转换为 FortuneSheet；`@univerjs/core` 仅保留旧格式转换需要的类型和枚举，不再运行旧表格编辑器。ExcelJS 保留基础 XLSX 导入导出。

## 文档协作开发验证

设置 `DOC_COLLAB_VERIFY_ENABLED=true` 后启动开发环境，在文档顶部点击「协作验证」。同一文档 ID 的页面使用 Tiptap Collaboration + Yjs + Hocuspocus 4.7.0 同步正文，显示在线光标与选区，支持个人撤销和自动重连。初始化由服务端指定单个页面导入本地正文，其他页面读取权威内容，避免重复导入；验证模式下标题只读，文件名称与空间元数据暂不参与协作。

每份文档默认最多 **10 个编辑会话**，`DOC_COLLAB_MAX_SESSIONS` 可配置 1–100。同账号多页面分别占名额，第 11 个会话拒绝；连接关闭释放名额。文档与表格的会话上限分别配置。服务端通过 Hocuspocus 接收 Yjs 更新，将二进制状态原子替换写入 `DOC_COLLAB_VERIFY_DIR`（默认 `runtime/document-verification`，已忽略）。客户端核对持久化确认的 Yjs 状态快照（包含删除信息）后才显示「已保存到服务器」。

断线时暂停编辑并自动重连，当前页面保留未同步更新；不要在未确认保存时关闭 / 刷新页面。浏览器刷新后重新点击验证入口读取服务器状态，页面丢失前的未落盘输入不保证恢复。服务退出会等待验证状态写入。协议测试包含同位置并发收敛、个人撤销、隔离房间、重连、服务端直接写入广播、重启恢复、10 会话限制及名额释放；浏览器验证正文双向同步与个人撤销。

此入口仅限本机 development，采用演示身份，默认关闭，预发 / 正式环境拒绝开启，生产前台不显示按钮。它不接入真实账号、空间权限、附件授权及业务版本；正式文档页面使用独立的业务协作链路，不能用此入口代替其验收。

## 密钥与版本存储

API 密钥的认证使用哈希，完整值采用 AES-256-GCM 加密保存。`AI_KEY_ENCRYPTION_KEY` 需配置为 64 位十六进制，未配置时仅影响新密钥创建及原文查看；已有密钥仍能认证。部署、备份恢复须保留此配置，更换后旧密钥原文无法解密。创建者可查看自己的完整密钥，空间负责人可管理空间全部密钥但不能读取他人原文。删除会移除密钥及其幂等记录，保留不含秘密的操作审计。迁移会将旧策略和密钥权限的交集写入密钥，原本关闭的密钥保持失效；旧密钥仅存哈希，无法补回完整值。

文档、表格和 PPT 每个文件最多保留最近 100 个历史版本，所有来源统一计数。生成新版本时在同一事务内清理超额版本，服务启动时也会清理已有超额版本。当前内容独立保存；清理只释放被删除版本的附件引用，仍被当前内容或其他版本引用的附件不会删除，失去全部引用的附件沿用现有宽限期清理。
