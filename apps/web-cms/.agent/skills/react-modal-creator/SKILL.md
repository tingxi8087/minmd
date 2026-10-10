---
name: react-modal-creator
description: 按 useImperativeHandle + ref.open 规范创建高复用、不接收 props 的 React 弹窗。ForwardedRef 暴露 open，参数与事件回调经 open 传入；弹窗内事件通过 onEvent 回调持续传给调用方。在需要实现或重构 React Modal、Dialog、弹窗组件，或用户提到「弹窗通过 ref 调用」「不接 props 的弹窗」「弹窗事件回调」时使用。
---

# React Modal Creator

按「高复用、不接 props、通过 ref.open 调用、事件通过回调传出」的模式创建 React 弹窗。弹窗不接收 props，所有输入经 `open` 传入；外层通过 `ref.current?.open(config)` 打开弹窗；弹窗内每次交互都通过 `config.onEvent` 对外通知。

不要把 `open` 设计成等待关闭结果的 Promise。Promise 只能完成一次，无法表达弹窗打开期间的新增、编辑、删除、刷新、下一步、选择等连续事件。统一使用事件回调，让调用方可以在弹窗关闭前持续接收事件。

## 核心规范

| 条目 | 内容 |
|------|------|
| 高复用 | 弹窗逻辑与 UI 可复用到不同调用方 |
| 不接收 props | 组件声明为无 props（`{}` 或 `Record<string, never>`），所有输入经 `open` 传入 |
| 调用方式 | 通过 `ref` + `useImperativeHandle` 暴露 `open`，外层调用 `modalRef.current?.open(config)` |
| ForwardedRef 类型 | 显式定义接口，**必须**包含 `open` 方法；用 JSDoc 注明 |
| open 签名 | `open(config): void`；如业务确实需要，可返回同步控制句柄，但不要返回关闭结果 Promise |
| 事件传出 | `config` 中定义 `onEvent?: (event) => void \| Promise<void>`，弹窗内每次交互都调用 `onEventFn(event)` |
| open 实现 | 用 `useState` 保存 `open` 传入的配置；若某一项是**函数**，对应 state 命名为 `xxxFn` / `setXxxFn`（如 `onEventFn`, `setOnEventFn`） |
| 传值灵活 | 配置项可为字符串、对象、数组、函数等；按「展示/配置用变量，回调/副作用用方法」区分 |

## Ref 类型与 open

ForwardedRef 必须包含 `open`。事件类型使用可辨识联合类型，至少覆盖关闭类事件；复杂弹窗按业务扩展中间事件。

```typescript
/** 按业务定义；此处仅为示例 */
type ExampleModalEvent =
  | { type: 'success' }
  | { type: 'cancel' }
  | { type: 'closed' };

/** 按业务定义；此处仅为示例 */
interface ExampleModalConfig {
  title?: string;
  okBtnText?: string;
  /** 弹窗事件回调；state 存为 onEventFn */
  onEvent?: (event: ExampleModalEvent) => void | Promise<void>;
}

/**
 * 弹窗 Ref，通过 open 传入配置；弹窗事件经 onEvent 回调传出
 */
interface ExampleModalRef {
  /**
   * 打开弹窗，配置与事件回调经此处传入
   * @param config - 标题、按钮文案、事件回调等，按业务定义
   */
  open(config: ExampleModalConfig): void;
}
```

可按业务扩展 `type`（如 `'add' | 'edit' | 'delete' | 'query' | 'success' | 'closed' | 'cancel'`）或增加事件字段（如 `values`、`row`、`index`、`list`）。组件使用 `forwardRef<ExampleModalRef, {}>`，第二泛型表示不接收 props。

## 实现要点

1. **forwardRef**：`forwardRef<ModalRef, {}>` 或 `forwardRef<ModalRef, Record<string, never>>`，表示不接收 props。

2. **事件类型**：为每个弹窗定义 `XxxModalEvent` 可辨识联合类型。关闭类事件通常为 `success`、`cancel`、`closed`；中间事件按业务命名，如 `add`、`edit`、`delete`、`query`、`select`。

3. **useState 存 open 入参**：标题、文案、按钮文案、回调等。**若为函数则 state 名加 `Fn` 后缀**，例如：
   ```typescript
   const [onEventFn, setOnEventFn] = useState<(event: ExampleModalEvent) => void | Promise<void>>(() => () => {});
   ```

4. **useImperativeHandle**：`useImperativeHandle(ref, () => ({ open }), [])`。`open` 实现为：
   - `(config) => { setXxx(config.xxx); setOnEventFn(() => config.onEvent ?? (() => {})); setVisible(true); }`
   - 事件结果只通过 `onEventFn` 通知调用方。

5. **事件触发**：在「确定」「取消」「关闭」「新增」「编辑」「删除」「刷新」等分支调用 `await onEventFn({ type, ...payload })`。如果该事件代表弹窗结束，再调用 `setVisible(false)`。

6. **config 结构**：必选/可选按业务定，用 TS 接口 + JSDoc 描述。

## 方法 vs 变量（何时用 Fn 后缀）

- **传方法（state 加 Fn 后缀）**：`onEvent`、`onOk`、`onCancel`、`onClose`、`beforeClose`、`validate`、自定义事件回调等——在弹窗内部「某个时机」被调用的函数。例如：`onEventFn` / `setOnEventFn`。
- **传变量（普通 state 名）**：`title`、`content`、`okBtnText`、`data`、`initialValues` 等——仅用于展示或作为不可变配置。

优先使用统一的 `onEvent` 承载弹窗向外传出的事件。只有当业务已有明确约定，或某个回调属于纯内部校验/拦截时，才额外定义 `onSubmit`、`beforeClose` 这类专用函数。

## 使用示例

```typescript
const modalRef = useRef<ExampleModalRef | null>(null);

// 调用
modalRef.current?.open({
  title: '标题',
  okBtnText: '确定',
  onEvent: async (event) => {
    if (event.type === 'success') {
      // 用户点击确定
    }
    if (event.type === 'closed') {
      // 用户关闭或点击遮罩
    }
  },
});

// 声明
<ExampleModal ref={modalRef} />
```

## 检查清单

创建或审查弹窗时确认：

- [ ] 组件为 `forwardRef<XxxModalRef, {}>`，不接收 props
- [ ] `XxxModalRef` 接口**必须**包含 `open`，并配有 JSDoc
- [ ] `open(config): void`，不返回关闭结果 Promise
- [ ] `config` 中包含 `onEvent?: (event: XxxModalEvent) => void | Promise<void>`
- [ ] `open` 内部用 `useState` 存 config；**函数类入参**对应 state 命名为 `xxxFn` / `setXxxFn`
- [ ] 弹窗内每个用户事件都调用 `onEventFn({ type, ...payload })`
- [ ] 只有结束类事件（如 `success`、`cancel`、`closed`）触发后才 `setVisible(false)`
- [ ] 弹窗结果和中间操作都通过 `onEventFn` 传出
- [ ] 类型与函数注释使用 JSDoc；不引入 `useCallback` / `useMemo`

## 更多示例

确认框、表单弹窗、表格弹窗等完整 Ref 类型、组件骨架与调用方代码见 [examples.md](examples.md)。
