# 管理后台开发规范

本文件仅适用于 `apps/web-cms/`，同时遵循根目录 [AGENTS.md](../../AGENTS.md)。安装、启动、部署与测试环境见根目录 [README.md](../../README.md)。下文 `src/` 路径相对于本目录。

## 优先复用

开始实现前先检查对应组件、hooks 和调用页面，简要说明准备复用什么。优先直接复用，其次在页面组合，再考虑兼容扩展；不要复制 hooks 或引入第二套状态、请求、权限实现。

| 需求 | 入口与参考 |
| --- | --- |
| 真实管理列表 | `src/views/AppUsers/index.tsx`、`src/views/AdminAccounts/index.tsx` |
| 查询、字段配置、展开收起 | `src/components/SearchTableForm/index.tsx`；[组件说明](src/components/SearchTableForm/readme.md) |
| 分页、查询、加载、刷新 | `src/hooks/useTableHooks.ts` 导出的 `useBasePageTable` |
| 行选择、批量操作 | 同入口的 `useTableChecked`；参考 `src/views/UserCurd/index.tsx` |
| 剩余高度 | `src/hooks/useElementBottomDistance.ts` |
| 异步资源 | `src/hooks/useResource.ts` |
| 最新状态及事件回调 | `src/hooks/useRefState.ts` |
| 用户表单抽屉 | `src/views/AppUsers/components/UserFormDrawer/index.tsx` |
| 角色与分组权限选择 | `src/views/RoleManage/` |
| HTTP 客户端及业务服务 | `src/http/`、`src/http/services/appUsers.ts` |
| 权限展示 | `src/hooks/useAccess.ts`、`src/components/Access/index.tsx`、`src/router/` |
| 全局状态 | `src/store/sys.ts`；上游用法参考 `src/views/EBoxUse` |
| Markdown 展示 | `src/components/MarkdownViewer/`；[组件说明](src/components/MarkdownViewer/README.md) |
| 图表 | `src/components/EChart/`、`src/views/ChartExamples/` |
| 通用工具 | `src/utils/index.ts` |

UserCurd、ChartExamples 等上游演示源码可供参考，但没有注册为当前路由，Mock 不能代替真实管理接口。上游来源记录见 [UPSTREAM.md](UPSTREAM.md)。

## 目录与技术栈

- 使用现有 React、TypeScript、Vite、Ant Design、Hash Router、Less/CSS Modules 和 e-boxes。不为个人偏好换库。
- 页面采用 `src/views/PageName/index.tsx`，页面私有组件放该页面的 `components/`；布局私有组件放 `src/layout/components/`。
- 组件采用 `ComponentName/index.tsx` 和 `index.module.less`。真正跨页面、业务无关的能力才放 `src/components/`，不要提前抽象业务框架。
- 页面和组件目录用 PascalCase，hooks 用 `useXxx.ts`；已有工具命名保留。跨模块使用 `@/`，邻近私有文件可使用相对路径。
- 路由与菜单元数据放 `src/router/`，请求放 `src/http/services/`。沿用客户端及拦截器，不在页面新建 axios 实例。
- 图标沿用 `@ant-design/icons`，日期优先 dayjs，工具先查现有依赖。样式跟随组件，全局样式只处理真正全局需求。

## 页面与组件

- 保持当前紧凑后台风格、侧栏和顶栏，不另加占空间的大标题区。
- 查询区单独一个 Card；操作栏、表格和分页放另一个 Card。保持现有间距和尺寸。
- 查询使用 SearchTableForm，分页和刷新使用 useBasePageTable，不再维护第二份分页、loading 或请求状态。
- 使用 useTableChecked 时，行数据 `_checked` 是选中状态唯一来源，从中派生 ID 和数量，不再保存平行的 selected state。
- 表格高度复用 useElementBottomDistance，按实际工具栏和分页预留高度，检查窄屏及纵向溢出。不要重复创建 ResizeObserver。
- 现有封装能满足需求时直接用；否则组合 Ant Design 的 Table、Form、Drawer、Modal、Tabs、Descriptions 等。不为基础组件增加单纯透传包装。
- 优先组件公开 API、主题 token 和局部样式，不依赖易变的内部 DOM 做大范围覆盖。新组件需有明确缺口和真实复用需求。
- 公共组件通过 props 接收数据及回调，不依赖某张业务表、页面 store、特定接口或 Mock。命令式弹窗按下面约定处理。
- 图表 EChart 仅负责初始化、配置更新、尺寸适配和销毁；数据获取留在页面。新增图表类型需检查按需注册，并提供可访问名称。

## 弹窗与抽屉

自定义业务 Modal / Drawer 使用同一命令式约定，不要求开发者安装本机技能才能遵循：

```ts
interface EditorRef {
  open(config: EditorConfig): void;
}
interface EditorConfig {
  // 业务数据、模式等按需定义
  onEvent?: (event: EditorEvent) => void | Promise<void>;
}
type EditorEvent =
  | { type: "save"; id: string }
  | { type: "cancel" };
```

- `forwardRef` + `useImperativeHandle` 暴露 `ref.current?.open(config)`，不接收业务 props；用 JSDoc 描述 Ref、配置和事件。
- 显示、关闭、表单数据与保存状态由弹窗管理。每次 open 重置数据、校验与回调，页面不另维护 open 状态。
- `open` 返回 void，不返回等待关闭结果的 Promise。保存、取消、关闭等交互通过可辨识联合类型的 `onEvent` 通知调用方。
- 回调存入 state 时使用 `onEventFn`，通过 `setOnEventFn(() => config.onEvent ?? (() => {}))` 保存，避免被 React 当成更新函数执行。
- 保存等待调用方回调完成，失败保留输入；保存期间防重复提交并禁止关闭。仅成功或明确关闭后结束本次编辑。
- 不为套用模板额外加入 useCallback/useMemo 或通用弹窗管理框架。

## 状态、身份与权限

- 全局状态使用现有 e-boxes；局部交互用组件状态，需要最新状态的事件或异步回调优先 useRefState。
- 请求、认证存储和错误处理复用 `src/http`；组件不要自行处理另一套 token。
- 菜单及按钮复用 useAccess、Access 和路由权限机制。后端仍需鉴权，前端隐藏不能替代接口授权。
- 前台用户管理是管理员操作页面，不是前台登录页。后台角色和前台角色的筛选必须保留；metadata 只作为额外资料，不能控制界面授权。
- 查询、保存失败有可见反馈；校验、loading、空数据、危险操作确认使用已有 Ant Design 能力，不另造一套提示框架。

## 验收与维护

- 所有依赖安装使用根目录 Bun workspace 和锁文件，不使用 cnpm/npm 建立独立安装流程。
- 修改公共能力前找全调用方，兼容旧使用方式并验证相关页面；同步更新本文件的入口表或组件自身说明。
- 从根目录运行 `bun run typecheck`、`bun run --cwd apps/web-cms lint`。修改 hooks / 组件时按需运行 `bun run --cwd apps/web-cms test`。
- 页面交互变更用真实后台接口进行浏览器验收；包括新建、编辑、失败校验、权限和刷新持久化。回归入口为 `test:e2e:debug`，独立库设置见根 README。
- 发布、资源路径或路由变动执行 `bun run build`，检查窄屏、滚动条、抽屉及键盘操作。不要因测试需要修改用户使用中的预览端口或停止其进程。
- 删除 Markdown 时搜索 `?raw` 导入和文档链接，防止保留的演示源码出现悬空引用。
