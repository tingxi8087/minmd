# MinMD

可自行部署的轻量文档空间，支持文档编辑、表格编辑和 PPTX 只读预览。前台参考飞书交互，管理后台和后端复用 MAS。

当前完成工程整合：前台位于 `apps/web`，MAS 后端和管理后台已引入。**MinMD 前台业务仍为本地演示，尚未接入真实账号、空间与文件接口；多人协作尚未实现。** 后台账号、角色、前台用户管理及后端健康检查为脚手架真实能力。

设计见 [TRD](docs/TRD.md)，进度见 [TODO](TODO.md)，脚手架版本和许可证见 [上游来源](docs/UPSTREAM.md)。开发规范见 [AGENTS.md](AGENTS.md)。

## 启动

要求 Bun 1.3.13+、PostgreSQL（已用 PostgreSQL 18 验证）。从仓库根目录执行：

```sh
bun install --frozen-lockfile
cp .env.example .env
```

已有 `.env` 时不要覆盖。填写数据库连接和首次管理员账号密码，数据库需预先创建；迁移只创建表结构。

```sh
bun run db:migrate
bun run dev
```

默认地址：前台 <http://127.0.0.1:5173/>，后台 <http://127.0.0.1:5174/>，后端 <http://127.0.0.1:9811>。`GET /api/health` 会实际检查数据库连接。端口由 `.env` 的 `WEB_PORT`、`WEB_CMS_PORT`、`PORT` 配置，后端变更时同步修改 `API_PROXY_TARGET`。

后台第一版使用脚手架 Bearer 认证；前台仍是演示登录。Cookie 认证与前台业务在后续阶段联调，不能把前台演示视为真实鉴权。

可选开发数据库（需要 Docker 正常运行）：

```sh
docker compose -f deploy/compose.yaml up -d
```

此 Compose 目前只启动开发 PostgreSQL，默认连接与 `.env.example` 一致；完整应用 Docker 部署在后续阶段完成。首次管理员从 `.env` 初始化，仅在库中没有超管时生效。不要对外使用模板默认密码。

## 命令和目录

| 命令 | 用途 |
|---|---|
| `bun run dev` | 同时启动前台、后台、后端；一个子服务退出时关闭其他子服务 |
| `bun run dev:web` | 单独启动前台 |
| `bun run dev:web-cms` | 单独启动管理后台 |
| `bun run dev:server` | 单独启动后端 |
| `bun run build` | 构建 `dist/web`、`dist/web-cms`、`dist/server` |
| `bun run start` | 运行构建后的后端；预发 / 正式可挂载后台，前台需单独静态服务 |
| `bun run preview` | 预览构建后的前台（仅静态页面，不代理业务 API） |
| `bun run typecheck` | 检查后端和两个前端 |
| `bun run check` | 类型检查、后端测试和现有前台行为检查；未指定测试库时数据库测试跳过 |
| `bun run test:integration` | 使用 `TEST_DATABASE_URL` 指定的专用测试库运行数据库 / 鉴权测试 |
| `bun run db:generate` / `bun run db:migrate` | 生成 / 执行数据库迁移 |

```text
apps/web/              MinMD 前台及编辑器
apps/web-cms/          MAS 管理后台
apps/app_server/       业务后端（当前包含脚手架前台账号模块）
system/server/         通用认证、角色权限、日志和基础服务
config/                权限及开发配置
database/migrations/  数据库迁移
scripts/               根目录开发、构建与数据库工具
apps/web/scripts/      原有前台行为检查脚本
deploy/                开发数据库 Compose
```

根目录维护唯一 `bun.lock`，各应用通过 Bun workspace 安装。前台接口代理为 `/api`；开发前后台使用不同端口。后台部署路径示例为 `/admin`，修改配置后需重启后端。正式 Cookie 模式需要 HTTPS 和匹配的访问来源。

验收命令示例：

```sh
bun run check
RUNTIME_PROCESS_TEST=true bun test tests/runtime-process.test.ts
DEV_PROCESS_DATABASE_URL=postgresql://user:password@127.0.0.1:5432/minmd_test RUNTIME_PROCESS_TEST=true bun test tests/dev-process.test.ts
bun run --cwd apps/web-cms lint
TEST_DATABASE_URL=postgresql://user:password@127.0.0.1:5432/minmd_test bun run test:integration
```

数据库测试必须使用独立 `_test` 库，不指向日常开发库或生产库。配置、运行日志、数据库文件、上传文件和验收截图均不提交 Git。`dist/.env.example` 仅为公开配置模板，不包含本机凭证。

本机设置了全局 HTTP 代理时，验收命令需在前面加 `env -u HTTPS_PROXY -u HTTP_PROXY -u ALL_PROXY`，确保本地健康检查直接连接。开发进程已对 Vite 的本地代理设置 `NO_PROXY`。

## 已有交互

- 空间切换、文件夹浏览、类型筛选、搜索、列表 / 网格视图。
- 新建、重命名、收藏、移动、回收站删除 / 恢复；文件列表、网格和左侧文件树支持自定义右键菜单，「…」使用相同菜单。
- 文档「…」菜单支持重命名、移动、收藏、分享、导入 / 导出与详情；正文右键支持撤销 / 重做、复制 / 剪切、粘贴纯文本、全选、分享与导出，表格使用专用菜单。
- 侧栏文件树支持嵌套文件夹、父子文档、拖拽移动与同级排序；节点菜单支持在当前位置新建。移动会阻止循环嵌套与跨空间移动。
- 导航可展开 / 收起，拖动右侧边缘可调整宽度（180–400px），布局偏好本地保存；底部保留 AI、回收站、设置三个图标，成员管理在设置中。
- 文档标题按 Enter 进入正文，中文输入法确认文字时保持标题焦点。
- 文档支持标题、正文、文本格式、列表、待办、引用、代码、链接、图片和正文表格；选中文字浮动菜单、`/` 插入菜单、目录跳转、撤销 / 重做。
- 代码块内选中文字不显示浮动格式栏；语言下拉支持常用类型与自定义类型（搜索后选择自定义项），语言随文档保存，并保留在 Markdown 导入 / 导出的代码围栏中；lowlight 语法高亮随编辑和语言切换实时更新，支持浅色 / 深色主题，未知类型保持纯文本。
- 插入表情支持分类、搜索与最近使用；高亮块可调整表情和主题底色，折叠块支持标题与正文编辑、展开 / 收起；文档引用可搜索当前空间并跳转，日期可选择后插入。
- `/` 菜单支持分组、中文 / 常用拼音缩写 / 英文搜索；正文空格后的行内菜单提供表情、日期与文档引用。菜单自动避让光标行，打开时锁定文档滚动。
- 高亮块导出 Markdown 转成引用，折叠块展开为标题及全部正文，文档引用转成链接；导出前提示外观变化，原文保留。
- H1–H6 支持章节折叠：标题 hover 显示箭头，收起到下一个同级或更高级标题；嵌套折叠状态及刷新保留，目录跳转自动展开必要的父级，Markdown 始终导出完整内容。
- 正文表格 hover / 聚焦时显示底部与右侧「＋」，可直接在末尾追加行列；选中单元格后工具栏提供上下插行、左右插列，右键菜单提供插入与删除行列、删除范围高亮，支持选中多行 / 多列批量删除；删除整个表格在工具栏，操作可撤销，保留列宽拖拽。
- 文档图片单击显示选中边框与四角缩放手柄，工具栏支持左对齐、居中、右对齐；按比例拖动调整大小、支持撤销 / 重做和恢复原始大小。双击或点击放大按钮打开预览，支持缩放与拖动查看。尺寸和对齐随文档 JSON 保存，标准 Markdown 保留图片内容而不保留显示尺寸与对齐。
- 文档 JSON 自动保存，刷新后恢复；Markdown 导入为可编辑正文并支持导出。导入上限 2MB，本地图片上限 1MB。
- 顶部与浮动工具栏支持文字颜色、文字背景色和字号；紧凑选色面板包含预设色、两类自定义选色（字体色和背景色各只保留最后一个自定义颜色），支持恢复默认；包含字体颜色、背景颜色或字号时，导出 Markdown 会提示样式丢失，确认后导出标准 Markdown，原文档不受影响。
- 幻灯片仅支持 `.pptx`（上限 50 MB），通过 `@aiden0z/pptx-renderer` 在浏览器直接解析；支持上传 / 替换、缩略图跳转、翻页、左右方向键、50%–200% 缩放、全屏和原文件下载。原文件存入 IndexedDB 的 `minmd-files`，刷新后可恢复；清除浏览器数据会删除本机原文件。复杂版式与字体还原取决于渲染库，不提供编辑和动画播放。
- 表格使用 Univer OSS，采用开始 / 插入 / 公式 / 数据 / 视图五个 Tab 和两行分组工具栏；支持编辑、公式、多工作表、格式设置、行列操作、筛选、排序、数据验证与撤销 / 重做；自动保存到浏览器 IndexedDB，删除文件时清理对应数据。
- ExcelJS 负责 `.xlsx` 导入导出，支持数据、公式、常用字体与颜色、背景色、数字格式、边框、合并单元格、冻结行列和尺寸及筛选范围；筛选条件、数据验证规则暂不进行 Excel 转换，本地保存会保留。不保证复杂 Excel 完整还原，图表、透视表、宏等高级对象暂不转换。导入限制 20 MB、20 万个非空单元格，单表最多 1 万行 / 1 千列。空间首页导入可创建表格，表格页导入会替换当前内容。
- 公开 / 私有设置、分享密码与有效期表单。没有真实公开链接，也不执行访问授权。
- 空间成员样例、演示密钥创建 / 撤销、MCP / API 配置模板。
- 浅色 / 深色主题与演示登录。

演示状态保存在 localStorage 的 `minmd-static-demo-v1`，可在空间设置中重置。不要输入真实密码或密钥；分享密码是本地演示值。账号密码不保存，演示 API Key 无访问能力。

## 主题与工程

`apps/web/src/theme.less` 集中定义语义颜色、文件类型颜色、字体、间距、尺寸、圆角与动效变量。`data-theme` 切换浅色 / 深色，Ant Design 配置同步读取颜色变量。样例纸张使用单独的预览色变量。

React 18、TypeScript、Vite、Hash Router、Zustand、Ant Design、Tiptap、lucide-react、Less Modules。跨模块引用使用 `@/`，页面与组件采用目录式组织。

后续：业务前台接入 MAS 前台认证与空间接口；后台账号与系统权限沿用脚手架自带管理界面。管理后台已引入，但 MinMD 空间、文件和 AI 业务尚未接入。
