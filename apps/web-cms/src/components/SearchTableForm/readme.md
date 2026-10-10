# SearchTableForm 表格查询表单组件

一个功能强大的表格查询表单组件，支持多种字段类型、字段折叠展开、表单重置和查询等功能。基于 Ant Design Form 封装，提供统一的配置化表单解决方案。

## 功能特性

- ✅ **多种字段类型**：支持 input、inputNumber、select、selectAsync、date、dateRange、cascader、custom 等
- ✅ **字段折叠展开**：当字段数量超过阈值时自动显示折叠/展开按钮
- ✅ **双向绑定**：支持表单值和展开状态的双向绑定
- ✅ **响应式布局**：基于 Ant Design 栅格系统，自动计算按钮位置
- ✅ **表单验证**：完整的表单验证支持
- ✅ **键盘快捷键**：支持 Enter 键快速查询
- ✅ **Ref 方法暴露**：提供 form、submit、reset 等方法供外部调用
- ✅ **灵活配置**：支持自定义类名、初始值、回调函数等

## 基础用法

### 1. 简单查询表单

```tsx
import SearchTableForm, { FormFieldConfig } from '@/components/SearchTableForm';

const fields: FormFieldConfig[] = [
  {
    name: 'keyword',
    label: '关键词',
    type: 'input',
    placeholder: '请输入关键词',
  },
  {
    name: 'status',
    label: '状态',
    type: 'select',
    options: [
      { value: '1', label: '启用' },
      { value: '0', label: '禁用' },
    ],
  },
];

const MyComponent = () => {
  const handleFinish = (values: Record<string, any>) => {
    console.log('查询参数:', values);
    // 执行查询逻辑
  };

  return (
    <SearchTableForm
      fields={fields}
      onFinish={handleFinish}
    />
  );
};
```

### 2. 带初始值的表单

```tsx
const MyComponent = () => {
  const initialValues = {
    keyword: '',
    status: '1',
  };

  return (
    <SearchTableForm
      fields={fields}
      initialValues={initialValues}
      onFinish={handleFinish}
    />
  );
};
```

### 3. 使用 Ref 控制表单

```tsx
import { useRef } from 'react';
import SearchTableForm, { TableFormRef } from '@/components/SearchTableForm';

const MyComponent = () => {
  const formRef = useRef<TableFormRef>(null);

  const handleExternalSubmit = () => {
    // 外部触发查询
    formRef.current?.submit();
  };

  const handleExternalReset = () => {
    // 外部触发重置
    formRef.current?.reset();
  };

  const handleGetFormValues = () => {
    // 获取表单值
    const values = formRef.current?.form.getFieldsValue();
    console.log('表单值:', values);
  };

  return (
    <>
      <SearchTableForm
        ref={formRef}
        fields={fields}
        onFinish={handleFinish}
      />
      <Button onClick={handleExternalSubmit}>外部查询</Button>
      <Button onClick={handleExternalReset}>外部重置</Button>
      <Button onClick={handleGetFormValues}>获取表单值</Button>
    </>
  );
};
```

### 4. 双向绑定表单值

```tsx
import { useState } from 'react';

const MyComponent = () => {
  const [formValues, setFormValues] = useState({});

  return (
    <SearchTableForm
      fields={fields}
      value={formValues}
      onValuesChange={(changedValues, allValues) => {
        setFormValues(allValues);
      }}
      onFinish={handleFinish}
    />
  );
};
```

## 字段类型示例

### Input 输入框

```tsx
{
  name: 'keyword',
  label: '关键词',
  type: 'input',
  placeholder: '请输入关键词',
  span: 6, // 栅格占位，默认 6
}
```

### InputNumber 数字输入框

```tsx
{
  name: 'age',
  label: '年龄',
  type: 'inputNumber',
  placeholder: '请输入年龄',
  itemProps: {
    min: 0,
    max: 150,
  },
}
```

### Select 下拉选择

```tsx
{
  name: 'status',
  label: '状态',
  type: 'select',
  options: [
    { value: '1', label: '启用' },
    { value: '0', label: '禁用' },
  ],
  itemProps: {
    allowClear: true,
    showSearch: true,
  },
}
```

### SelectAsync 异步选择器

```tsx
{
  name: 'userId',
  label: '用户',
  type: 'selectAsync',
  getData: async (searchText: string) => {
    const response = await fetch(`/api/users?search=${searchText}`);
    const data = await response.json();
    return data.map((user: any) => ({
      value: user.id,
      label: user.name,
    }));
  },
}
```

> 更多 SelectAsync 用法请参考 [SelectAsync 实现](./components/SelectAsync/index.tsx)

### Date 日期选择器

```tsx
{
  name: 'date',
  label: '日期',
  type: 'date',
  itemProps: {
    format: 'YYYY-MM-DD',
  },
}
```

### DateRange 日期范围选择器

```tsx
{
  name: 'dateRange',
  label: '日期范围',
  type: 'dateRange',
  placeholder: ['开始日期', '结束日期'],
  itemProps: {
    format: 'YYYY-MM-DD',
  },
}
```

### Cascader 级联选择器

```tsx
{
  name: 'region',
  label: '地区',
  type: 'cascader',
  options: [
    {
      value: 'zhejiang',
      label: '浙江',
      children: [
        {
          value: 'hangzhou',
          label: '杭州',
        },
      ],
    },
  ],
}
```

### Custom 自定义组件

```tsx
{
  name: 'customField',
  label: '自定义字段',
  type: 'custom',
  component: <YourCustomComponent />,
}
```

## 完整示例

```tsx
import SearchTableForm, { FormFieldConfig } from '@/components/SearchTableForm';

const fields: FormFieldConfig[] = [
  {
    name: 'keyword',
    label: '关键词',
    type: 'input',
    placeholder: '请输入关键词',
    span: 6,
  },
  {
    name: 'status',
    label: '状态',
    type: 'select',
    options: [
      { value: '1', label: '启用' },
      { value: '0', label: '禁用' },
    ],
    span: 6,
  },
  {
    name: 'dateRange',
    label: '日期范围',
    type: 'dateRange',
    placeholder: ['开始日期', '结束日期'],
    span: 6,
  },
  {
    name: 'userId',
    label: '用户',
    type: 'selectAsync',
    getData: async (searchText: string) => {
      const response = await fetch(`/api/users?search=${searchText}`);
      const data = await response.json();
      return data.map((user: any) => ({
        value: user.id,
        label: user.name,
      }));
    },
    span: 6,
  },
];

const MyComponent = () => {
  const handleFinish = (values: Record<string, any>) => {
    console.log('查询参数:', values);
    // 执行查询逻辑
  };

  const handleReset = () => {
    console.log('表单已重置');
  };

  return (
    <SearchTableForm
      fields={fields}
      onFinish={handleFinish}
      onReset={handleReset}
      collapseThreshold={4} // 超过 4 个字段时显示折叠按钮
      defaultExpanded={false} // 默认折叠
    />
  );
};
```

## API 参数

### TableFormProps

| 参数 | 说明 | 类型 | 默认值 |
|------|------|------|--------|
| fields | 表单字段配置数组 | `FormFieldConfig[]` | - |
| className | 自定义类名 | `string` | - |
| value | 表单值（双向绑定） | `FormValues` | - |
| initialValues | 表单初始值 | `FormValues` | - |
| onFinish | 查询按钮事件 | `(values: FormValues) => void` | - |
| onReset | 重置按钮事件 | `() => void` | - |
| onValuesChange | 表单值变化回调（双向绑定） | `(changedValues: FormValues, allValues: FormValues) => void` | - |
| expanded | 展开状态（双向绑定） | `boolean` | - |
| onExpandChange | 折叠展开状态变化回调（双向绑定） | `(expanded: boolean) => void` | - |
| defaultExpanded | 默认是否展开 | `boolean` | `false` |
| collapseThreshold | 超过多少个字段时显示折叠按钮 | `number` | `4` |

> 其他 Ant Design Form 组件的属性也会透传，如 `labelAlign`、`autoComplete`、`colon` 等。

### FormFieldConfig

| 参数 | 说明 | 类型 | 默认值 |
|------|------|------|--------|
| name | 字段名，对应 Form.Item 的 name | `string` | - |
| label | 标签 | `string` | - |
| type | 控件类型 | `FormFieldType` | - |
| span | 栅格占位格数 | `number` | `6` |
| placeholder | 占位符 | `string \| [string, string]` | - |
| options | 下拉选项（select/cascader 使用） | `FormFieldOption[] \| CascaderOption[]` | - |
| getData | 异步选择器数据获取函数（selectAsync 使用） | `SelectAsyncGetData` | - |
| component | 自定义组件（type 为 custom 时使用） | `React.ReactNode` | - |
| itemProps | 传递给具体控件的属性 | 根据 type 不同对应不同组件的属性 | - |

> 其他 Ant Design Form.Item 的属性也会透传，如 `rules`、`required` 等。

### FormFieldType

```typescript
type FormFieldType =
  | 'input'           // 输入框
  | 'inputNumber'     // 数字输入框
  | 'select'          // 下拉选择
  | 'selectAsync'     // 异步下拉选择
  | 'date'            // 日期选择器
  | 'dateRange'       // 日期范围选择器
  | 'cascader'        // 级联选择器
  | 'custom';         // 自定义组件
```

### TableFormRef

通过 ref 可以访问以下方法和属性：

| 方法/属性 | 说明 | 类型 |
|----------|------|------|
| form | Form 实例 | `FormInstance` |
| submit | 提交表单 | `() => void` |
| reset | 重置表单 | `() => void` |

## 类型定义

```typescript
/** 表单值类型 */
export type FormValues = Record<string, any>;

/** 表单字段类型 */
export type FormFieldType =
  | 'input'
  | 'inputNumber'
  | 'select'
  | 'selectAsync'
  | 'date'
  | 'dateRange'
  | 'cascader'
  | 'custom';

/** 下拉选项 */
export interface FormFieldOption {
  value: string | number;
  label: string;
}

/** 级联选择器选项 */
export interface CascaderOption {
  value: string | number;
  label: string;
  children?: CascaderOption[];
}

/** 表单项占位符类型 */
export type PlaceholderType = string | [string, string];

/** SelectAsync 数据获取函数类型 */
export type SelectAsyncGetData = (value: string) => Promise<FormFieldOption[]>;

/** 表单字段配置 */
export interface FormFieldConfig
  extends React.ComponentProps<typeof Form.Item> {
  name: string;
  label: string;
  type: FormFieldType;
  span?: number;
  placeholder?: PlaceholderType;
  options?: FormFieldOption[] | CascaderOption[];
  getData?: SelectAsyncGetData;
  component?: React.ReactNode;
  itemProps?: React.ComponentProps<typeof Select | Cascader | Input | InputNumber | DatePicker | DatePicker.RangePicker>;
}

/** 表单组件属性 */
export interface TableFormProps extends Omit<React.ComponentProps<typeof Form>, 'onValuesChange' | 'onFinish' | 'initialValues'> {
  fields: FormFieldConfig[];
  className?: string;
  value?: FormValues;
  initialValues?: FormValues;
  onFinish?: (values: FormValues) => void;
  onReset?: () => void;
  onValuesChange?: (changedValues: FormValues, allValues: FormValues) => void;
  expanded?: boolean;
  onExpandChange?: (expanded: boolean) => void;
  defaultExpanded?: boolean;
  collapseThreshold?: number;
}

/** 表单组件引用方法 */
export interface TableFormRef {
  form: FormInstance;
  submit: () => void;
  reset: () => void;
}
```

## 注意事项

1. **字段配置**：`fields` 数组中的每个配置项必须包含 `name`、`label`、`type` 属性
2. **SelectAsync 必填**：使用 `selectAsync` 类型时，必须提供 `getData` 函数
3. **Custom 组件**：使用 `custom` 类型时，必须提供 `component` 属性
4. **栅格布局**：默认每个字段占 6 格（24 格为一行），可通过 `span` 自定义
5. **折叠功能**：当字段数量超过 `collapseThreshold` 时，会自动显示折叠/展开按钮
6. **双向绑定**：使用 `value` 和 `onValuesChange` 实现表单值的双向绑定
7. **展开状态**：使用 `expanded` 和 `onExpandChange` 实现展开状态的双向绑定
8. **键盘事件**：支持 Enter 键快速触发查询
9. **按钮位置**：组件会自动计算按钮的栅格位置，确保始终在右侧显示

## 样式定制

组件使用 CSS Modules，可以通过 `className` 属性传入自定义类名进行样式定制：

```tsx
<SearchTableForm
  fields={fields}
  className="my-custom-form"
  onFinish={handleFinish}
/>
```

## 相关组件

- [SelectAsync](./components/SelectAsync/index.tsx) - 异步选择器组件

