# React Modal Creator 示例

## 示例 1：确认框（ConfirmModal）

`open` 接收 `title`、`content`、按钮文案及 `onEvent`。`type` 为 `'success'`（确定）、`'cancel'`（取消）、`'closed'`（遮罩/关闭）。点击任一按钮时先触发事件回调，再按结束类事件关闭弹窗。

### Ref 与 Config

```typescript
type ConfirmModalEvent =
  | { type: 'success' }
  | { type: 'cancel' }
  | { type: 'closed' };

/**
 * 确认框 open 入参
 */
interface ConfirmModalConfig {
  title?: string;
  content?: string;
  okBtnText?: string;
  cancelBtnText?: string;
  /** 弹窗事件回调；state 存为 onEventFn */
  onEvent?: (event: ConfirmModalEvent) => void | Promise<void>;
}

/**
 * 确认框 Ref
 */
interface ConfirmModalRef {
  /**
   * 打开确认框
   */
  open(config: ConfirmModalConfig): void;
}
```

### 组件骨架

```typescript
const ConfirmModal = forwardRef<ConfirmModalRef, {}>(function ConfirmModal(_, ref) {
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [okBtnText, setOkBtnText] = useState('确定');
  const [cancelBtnText, setCancelBtnText] = useState('取消');
  const [onEventFn, setOnEventFn] = useState<(event: ConfirmModalEvent) => void | Promise<void>>(() => () => {});

  const open: ConfirmModalRef['open'] = (config) => {
    setTitle(config.title ?? '');
    setContent(config.content ?? '');
    setOkBtnText(config.okBtnText ?? '确定');
    setCancelBtnText(config.cancelBtnText ?? '取消');
    setOnEventFn(() => config.onEvent ?? (() => {}));
    setVisible(true);
  };

  useImperativeHandle(ref, () => ({ open }), []);

  const handleOk = async () => {
    await onEventFn({ type: 'success' });
    setVisible(false);
  };

  const handleCancel = async () => {
    await onEventFn({ type: 'cancel' });
    setVisible(false);
  };

  const handleClose = async () => {
    await onEventFn({ type: 'closed' });
    setVisible(false);
  };

  if (!visible) return null;
  return (
    <div className="mask" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{content}</p>
        <button onClick={handleOk}>{okBtnText}</button>
        <button onClick={handleCancel}>{cancelBtnText}</button>
      </div>
    </div>
  );
});
```

### 调用方

```typescript
const confirmRef = useRef<ConfirmModalRef | null>(null);

confirmRef.current?.open({
  title: '确认删除',
  content: '删除后不可恢复，是否继续？',
  okBtnText: '删除',
  cancelBtnText: '取消',
  onEvent: async (event) => {
    if (event.type === 'success') { /* 用户点击确定 */ }
    if (event.type === 'cancel') { /* 用户点击取消 */ }
    if (event.type === 'closed') { /* 用户点击遮罩关闭 */ }
  },
});

<ConfirmModal ref={confirmRef} />
```

---

## 示例 2：表单弹窗（FormModal）

`open` 接收 `title`、`initialValues`、`onEvent`。提交成功触发 `{ type: 'success', values }`；取消或遮罩关闭触发 `{ type: 'cancel' | 'closed' }`。`initialValues` 为变量，`onEvent` 为方法，state 命名为 `onEventFn`。

### Ref 与 Config

```typescript
interface FormValues {
  name: string;
  amount?: number;
}

type FormModalEvent =
  | { type: 'success'; values: FormValues }
  | { type: 'cancel' }
  | { type: 'closed' };

/**
 * 表单弹窗 open 入参
 */
interface FormModalConfig {
  title?: string;
  initialValues?: Partial<FormValues>;
  /** 弹窗事件回调；state 存为 onEventFn */
  onEvent?: (event: FormModalEvent) => void | Promise<void>;
}

/**
 * 表单弹窗 Ref
 */
interface FormModalRef {
  /**
   * 打开表单弹窗
   */
  open(config: FormModalConfig): void;
}
```

### 组件骨架

```typescript
const FormModal = forwardRef<FormModalRef, {}>(function FormModal(_, ref) {
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [initialValues, setInitialValues] = useState<Partial<FormValues>>({});
  const [formValues, setFormValues] = useState<FormValues>({ name: '', amount: 0 });
  const [onEventFn, setOnEventFn] = useState<(event: FormModalEvent) => void | Promise<void>>(() => () => {});

  const open: FormModalRef['open'] = (config) => {
    setTitle(config.title ?? '');
    setInitialValues(config.initialValues ?? {});
    setFormValues({ name: '', amount: 0, ...config.initialValues });
    setOnEventFn(() => config.onEvent ?? (() => {}));
    setVisible(true);
  };

  useImperativeHandle(ref, () => ({ open }), []);

  const handleSubmit = async () => {
    await onEventFn({ type: 'success', values: formValues });
    setVisible(false);
  };

  const handleCancel = async () => {
    await onEventFn({ type: 'cancel' });
    setVisible(false);
  };

  const handleClose = async () => {
    await onEventFn({ type: 'closed' });
    setVisible(false);
  };

  if (!visible) return null;
  return (
    <div className="mask" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <input
          value={formValues.name}
          onChange={(e) => setFormValues((v) => ({ ...v, name: e.target.value }))}
        />
        <input
          type="number"
          value={formValues.amount ?? ''}
          onChange={(e) => setFormValues((v) => ({ ...v, amount: Number(e.target.value) || 0 }))}
        />
        <button onClick={handleSubmit}>提交</button>
        <button onClick={handleCancel}>取消</button>
      </div>
    </div>
  );
});
```

### 调用方

```typescript
const formRef = useRef<FormModalRef | null>(null);

formRef.current?.open({
  title: '编辑',
  initialValues: { name: '张三', amount: 100 },
  onEvent: async (event) => {
    if (event.type === 'success') { /* 使用 event.values */ }
    if (event.type === 'cancel') { /* 用户点击取消 */ }
    if (event.type === 'closed') { /* 遮罩关闭 */ }
  },
});

<FormModal ref={formRef} />
```

---

## 示例 3：表格弹窗（TableModal）

`open` 接收 `title`、**列表数据 `list`**（变量）和 `onEvent`（方法）。弹窗内展示表格，用户增删改查时持续触发 `add`、`delete`、`edit`、`query` 等中间事件；完成、取消、关闭时触发结束类事件。这样调用方可以在弹窗仍然打开时多次接收事件。

### Ref 与 Config

```typescript
interface TableRow {
  id: string;
  name: string;
  amount?: number;
}

type TableModalEvent =
  | { type: 'add' }
  | { type: 'delete'; row: TableRow; index: number }
  | { type: 'edit'; row: TableRow; index: number }
  | { type: 'query' }
  | { type: 'success'; list: TableRow[] }
  | { type: 'cancel' }
  | { type: 'closed' };

/**
 * 表格弹窗 open 入参
 */
interface TableModalConfig {
  title?: string;
  /** 列表数据（变量） */
  list: TableRow[];
  /** 弹窗事件回调；state 存为 onEventFn */
  onEvent?: (event: TableModalEvent) => void | Promise<void>;
}

/**
 * 表格弹窗 Ref
 */
interface TableModalRef {
  /**
   * 打开表格弹窗
   */
  open(config: TableModalConfig): void;
}
```

### 组件骨架

```typescript
const TableModal = forwardRef<TableModalRef, {}>(function TableModal(_, ref) {
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [list, setList] = useState<TableRow[]>([]);
  const [onEventFn, setOnEventFn] = useState<(event: TableModalEvent) => void | Promise<void>>(() => () => {});

  const open: TableModalRef['open'] = (config) => {
    setTitle(config.title ?? '');
    setList([...config.list]);
    setOnEventFn(() => config.onEvent ?? (() => {}));
    setVisible(true);
  };

  useImperativeHandle(ref, () => ({ open }), []);

  const handleAdd = async () => {
    await onEventFn({ type: 'add' });
  };

  const handleDelete = async (row: TableRow, index: number) => {
    await onEventFn({ type: 'delete', row, index });
  };

  const handleEdit = async (row: TableRow, index: number) => {
    await onEventFn({ type: 'edit', row, index });
  };

  const handleQuery = async () => {
    await onEventFn({ type: 'query' });
  };

  const handleConfirm = async () => {
    await onEventFn({ type: 'success', list });
    setVisible(false);
  };

  const handleCancel = async () => {
    await onEventFn({ type: 'cancel' });
    setVisible(false);
  };

  const handleClose = async () => {
    await onEventFn({ type: 'closed' });
    setVisible(false);
  };

  if (!visible) return null;
  return (
    <div className="mask" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div>
          <button onClick={handleAdd}>新增</button>
          <button onClick={handleQuery}>刷新</button>
        </div>
        <table>
          <thead><tr><th>名称</th><th>数量</th><th>操作</th></tr></thead>
          <tbody>
            {list.map((row, i) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.amount ?? '-'}</td>
                <td>
                  <button onClick={() => handleEdit(row, i)}>编辑</button>
                  <button onClick={() => handleDelete(row, i)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={handleConfirm}>完成</button>
        <button onClick={handleCancel}>取消</button>
      </div>
    </div>
  );
});
```

### 调用方

```typescript
const tableRef = useRef<TableModalRef | null>(null);
const [data, setData] = useState<TableRow[]>([]);

tableRef.current?.open({
  title: '管理列表',
  list: data,
  onEvent: async (event) => {
    if (event.type === 'add') {
      // 弹表单或调接口，获取新项后 setData(prev => [...prev, newItem])
    }
    if (event.type === 'delete') {
      // 使用 event.row 和 event.index 调删除接口，成功后 setData(...)
    }
    if (event.type === 'edit') {
      // 使用 event.row 和 event.index 弹表单编辑，提交后 setData(...)
    }
    if (event.type === 'query') {
      // 拉取最新 list 后 setData(res)
    }
    if (event.type === 'success') {
      setData(event.list);
    }
    if (event.type === 'cancel') {
      // 用户点击取消
    }
    if (event.type === 'closed') {
      // 用户点击遮罩关闭
    }
  },
});

<TableModal ref={tableRef} />
```
