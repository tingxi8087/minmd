import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";

import {
  Button,
  Cascader,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Tooltip,
} from "antd";

import { DownOutlined, SettingOutlined, UpOutlined } from "@ant-design/icons";

import DatePickerWrapper from "./components/DatePickerWrapper";
import DateRangePickerWrapper from "./components/DateRangePickerWrapper";
import NumberRangeInput from "./components/NumberRangeInput";
import QueryFieldSettingModal from "./components/QueryFieldSettingModal";
import SelectAsync from "./components/SelectAsync";
import SelectRange from "./components/SelectRange";

import styles from "./index.module.less";

/** 表单值类型 */
export type FormValues = Record<string, any>;

/**
 * 查询字段选择缓存项（持久化到 localStorage）
 */
interface FieldSettingCacheItem {
  /** 字段唯一标识 */
  field: string;
  /** 是否展示（被选中） */
  show?: boolean;
  /** 排序（越小越靠前） */
  sort?: number;
}

/**
 * 查询字段选择缓存 key（v2）
 * @param baseKey 业务侧传入的 key
 */
function getFieldSettingCacheKey(baseKey?: string): string | undefined {
  if (!baseKey) return undefined;
  return `${baseKey}__v2`;
}

/**
 * 从缓存反序列化结果中读取“已选字段顺序”并与当前全量字段对齐：
 * - 剔除已不存在的字段
 * - 新增字段默认追加到末尾（即默认展示）
 *
 * @param stored 反序列化后的缓存（FieldSettingCacheItem[]；也可能是不可信数据）
 * @param allFields 当前全量字段（以 fields.name 为准）
 */
function reconcileFieldOrderFromStored(
  stored: unknown,
  allFields: string[],
): string[] {
  if (!Array.isArray(stored)) {
    return allFields;
  }

  const cacheItems: FieldSettingCacheItem[] = (stored as any[])
    ?.map((it) => {
      if (!it || typeof it !== "object") return null;
      const field = (it as any).field;
      if (typeof field !== "string") return null;
      return {
        field,
        show: (it as any).show,
        sort: (it as any).sort,
      };
    })
    ?.filter(Boolean) as FieldSettingCacheItem[];

  const selectedKeys = cacheItems
    ?.filter((it) => it?.show)
    .map((it) => it.field);
  const cacheAllKeys = cacheItems?.map((it) => it.field);
  const addKeys = allFields?.filter((f) => !cacheAllKeys?.includes(f));

  const sortMap: Record<string, number | undefined> = {};
  let maxSort = -1;
  cacheItems.forEach((it) => {
    const sort = typeof it.sort === "number" ? it.sort : undefined;
    sortMap[it.field] = sort;
    if (typeof sort === "number" && sort > maxSort) {
      maxSort = sort;
    }
  });

  // 新增字段默认追加到末尾：在当前最大 sort 后顺延
  addKeys?.forEach((field, index) => {
    sortMap[field] = maxSort + index + 1;
  });

  return (
    allFields
      ?.filter((f) => selectedKeys?.includes(f) || addKeys?.includes(f))
      ?.sort((a, b) => (sortMap[a] || 0) - (sortMap[b] || 0)) || []
  );
}

/**
 * 将当前“已选字段顺序”写入 localStorage（同时记录全量字段 + show/sort，便于后续对齐）
 *
 * @param cacheKey localStorage key
 * @param allFields 全量字段
 * @param selectedOrder 已选字段顺序（仅包含 show=true 的字段）
 */
function persistFieldSettingCache(
  cacheKey: string,
  allFields: string[],
  selectedOrder: string[],
) {
  if (!cacheKey) return;
  try {
    const indexMap: Record<string, number> = {};
    selectedOrder.forEach((field, index) => {
      indexMap[field] = index;
    });
    const selectedSet = new Set(selectedOrder);
    const payload: FieldSettingCacheItem[] = allFields.map((field) => ({
      field,
      show: selectedSet.has(field),
      sort: indexMap[field],
    }));
    localStorage.setItem(cacheKey, JSON.stringify(payload));
  } catch (error) {
    console.error(error);
  }
}

/** 表单字段类型 */
export type FormFieldType =
  | "input"
  | "inputNumber"
  | "select"
  | "selectAsync"
  | "date"
  | "dateRange"
  | "cascader"
  | "numberRange"
  | "selectRange"
  | "custom";

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
export type SelectAsyncGetData = (value?: string) => Promise<FormFieldOption[]>;
export type FormFieldOptionsFetcher = (
  value?: string,
) => Promise<FormFieldOption[] | CascaderOption[]>;

/** 表单字段配置 */
export interface FormFieldConfig extends React.ComponentProps<
  typeof Form.Item
> {
  /** 字段名，对应 Form.Item 的 name */
  name: string;
  /** 标签 */
  label: string;
  /** 控件类型 */
  type: FormFieldType;
  /** 栅格占位格数，默认 6 */
  span?: number;
  /** 占位符 */
  placeholder?: PlaceholderType;
  /** 下拉选项（select/cascader 使用） */
  options?: FormFieldOption[] | CascaderOption[];
  /** 异步选项获取函数（select、cascader、selectAsync 使用） */
  getData?: FormFieldOptionsFetcher;
  /** 自定义组件（type 为 custom 时使用） */
  component?: React.ReactNode;
  /** 传递给具体控件的属性（根据 type 不同，对应不同组件的属性） */
  itemProps?:
    | React.ComponentProps<typeof Select>
    | React.ComponentProps<typeof Cascader>
    | React.ComponentProps<typeof Input>
    | React.ComponentProps<typeof InputNumber>
    | React.ComponentProps<typeof DatePicker>
    | React.ComponentProps<typeof DatePicker.RangePicker>;
  /** label 是否支持换行，默认 false */
  labelWrap?: boolean;
}

/** Form 组件的基础属性（排除需要自定义的属性） */
type BaseFormProps = Omit<
  React.ComponentProps<typeof Form>,
  "onValuesChange" | "onFinish" | "initialValues"
>;

/** 表单组件属性 */
export interface TableFormProps extends BaseFormProps {
  /** 页面ID，用于埋点上报 */
  pageId?: string;
  /** 表单项唯一标识，用于埋点上报 */
  clstagId?: string;
  /** 表单字段配置数组 */
  fields: FormFieldConfig[];
  /** 自定义类名 */
  className?: string;
  /** 表单值（双向绑定） */
  value?: FormValues;
  /** 表单初始值 */
  initialValues?: FormValues;
  /** 查询按钮事件（antd 标准命名） */
  onFinish?: (values: FormValues) => void;
  /** 重置按钮事件 */
  onReset?: () => void;
  /** 表单值变化回调（双向绑定） */
  onValuesChange?: (changedValues: FormValues, allValues: FormValues) => void;
  /** 展开状态（双向绑定） */
  expanded?: boolean;
  /** 折叠展开状态变化回调（双向绑定） */
  onExpandChange?: (expanded: boolean) => void;
  /** 默认是否展开，默认 false */
  defaultExpanded?: boolean;
  /** 超过多少个字段时显示折叠按钮，默认 4 */
  collapseThreshold?: number;
  expandLabelWidth?: string;
  dataReport?: any;
  /** 额外操作区（插入到“重置/查询”按钮旁边） */
  extraActions?: React.ReactNode;
  /**
   * 是否开启“查询字段选择”（默认 false）
   * 开启后会在按钮区展示“字段选择”入口，并允许用户自定义筛选项展示/顺序
   */
  enableFieldSetting?: boolean;
  /**
   * 查询字段选择缓存 key
   * 传入后会使用 localStorage 缓存用户选择（顺序/显隐）
   */
  fieldSettingCacheKey?: string;
  /**
   * 禁止隐藏的字段列表（字段 name 数组）
   * 这些字段在"字段选择"中永远选中，只能调整顺序，不能取消选中
   */
  disabledHideFields?: string[];
}

/** Form 实例类型 */
export type FormInstance = ReturnType<typeof Form.useForm<FormValues>>[0];

/** 表单组件引用方法 */
export interface TableFormRef {
  /** Form 实例 */
  form: FormInstance;
  /** 获取表单值 */
  getFieldsValue: () => FormValues;
  /** 提交表单 */
  submit: () => void;
  /** 重置表单 */
  reset: () => void;
  /** 设置表单值 */
  setValues: (values: FormValues) => void;
}

/**
 * 表格查询表单组件
 * 支持字段折叠展开、表单重置、查询等功能
 */
const SearchTableForm = forwardRef<TableFormRef, TableFormProps>(
  (
    {
      pageId,
      clstagId,
      fields,
      className,
      value,
      initialValues,
      onFinish,
      onReset,
      onValuesChange,
      expanded: expandedProp,
      onExpandChange,
      defaultExpanded = false,
      collapseThreshold = 4,
      expandLabelWidth = "110px",
      dataReport,
      extraActions,
      enableFieldSetting = false,
      fieldSettingCacheKey,
      disabledHideFields = [],
      ...rest
    },
    ref,
  ) => {
    const [form] = Form.useForm<FormValues>();
    const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
    const [asyncOptionsMap, setAsyncOptionsMap] = useState<
      Record<string, (FormFieldOption | CascaderOption)[]>
    >({});
    const [fieldSettingOpen, setFieldSettingOpen] = useState(false);

    const defaultFieldOrder = fields?.map((f) => f.name) || [];
    const [fieldOrder, setFieldOrder] = useState<string[]>([]);

    useEffect(() => {
      const allFields = fields?.map((f) => f.name) || [];
      if (!enableFieldSetting) {
        setFieldOrder(allFields);
        return;
      }
      // 优先使用缓存（参照 useTableColumnSetting 的策略：show=true 的字段 + 新增字段追加）
      const cacheKey = getFieldSettingCacheKey(fieldSettingCacheKey);
      if (cacheKey && localStorage.getItem(cacheKey)) {
        try {
          const storedValue = JSON.parse(
            localStorage.getItem(cacheKey) || "[]",
          ) as unknown;
          setFieldOrder(reconcileFieldOrderFromStored(storedValue, allFields));
          return;
        } catch (error) {
          console.error(error);
        }
      } else {
        setFieldOrder(allFields);
      }
    }, [enableFieldSetting, fieldSettingCacheKey, fields]);

    // 使用外部 expanded prop 或内部 state（双向绑定）
    const expanded =
      expandedProp !== undefined ? expandedProp : internalExpanded;
    // 同步外部 value 到表单（双向绑定）
    useEffect(() => {
      if (value !== undefined) {
        form.setFieldsValue(value);
      }
    }, [value, form]);

    // 异步获取 select/cascader 的 options
    useEffect(() => {
      let isUnmounted = false;
      const asyncFields =
        fields?.filter(
          (item: FormFieldConfig) =>
            item &&
            typeof item === "object" &&
            item?.getData &&
            (item.type === "select" || item.type === "cascader"),
        ) ?? [];
      if (!asyncFields?.length) {
        setAsyncOptionsMap({});
        return;
      }
      const fetchOptions = async () => {
        const tasks = asyncFields?.map(async (field) => {
          try {
            const options = (await field.getData?.("")) || [];
            return { name: field?.name, options };
          } catch (error) {
            console.error(
              `SearchTableForm getData error: ${field?.name}`,
              error,
            );
            return { name: field?.name, options: [] };
          }
        });
        const results = await Promise.all(tasks);
        if (isUnmounted) return;
        setAsyncOptionsMap((prev) => {
          const next = { ...prev };
          results.forEach(({ name, options }) => {
            next[name] = options;
          });
          return next;
        });
      };
      fetchOptions();
      return () => {
        isUnmounted = true;
      };
    }, [fields]);

    // 同步外部 expanded 到内部 state（双向绑定）
    useEffect(() => {
      if (expandedProp !== undefined) {
        setInternalExpanded(expandedProp);
      }
    }, [expandedProp]);

    // 处理查询按钮点击
    const handleSubmit = () => {
      form.validateFields().then((values) => {
        onFinish?.(values);
      });
    };

    // 处理重置
    const handleReset = () => {
      form.resetFields();
      onReset?.();
    };

    // 暴露给父组件的方法
    useImperativeHandle(ref, () => ({
      form,
      getFieldsValue: form.getFieldsValue,
      submit: handleSubmit,
      reset: form.resetFields,
      setValues: (values: FormValues) => {
        const currentValues: FormValues = {};
        visibleFields.forEach((field) => {
          const key = field.name;
          if (key) {
            currentValues[key] = undefined;
          }
        });
        form.setFieldsValue({ ...currentValues, ...values });
      },
    }));

    // 处理表单值变化（双向绑定）
    const handleValuesChange = (
      changedValues: FormValues,
      allValues: FormValues,
    ) => {
      onValuesChange?.(changedValues, allValues);
    };

    // 处理表单提交
    const handleFinish = (values: FormValues) => {
      onFinish?.(values);
    };

    // 处理键盘事件
    const handleKeyDown = (event: React.KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleSubmit();
      }
    };

    // 切换展开/收起状态
    const toggleExpanded = () => {
      const newExpanded = !expanded;
      if (expandedProp === undefined) {
        // 非受控模式，更新内部 state
        setInternalExpanded(newExpanded);
      }
      // 受控模式，通过回调通知外部
      onExpandChange?.(newExpanded);
    };

    // 渲染表单项
    const renderField = (fieldConfig: FormFieldConfig, index: number) => {
      const {
        name,
        type,
        span: spanProps = 6,
        component,
        label,
        itemProps,
        getData,
        placeholder,
        labelWrap,
        ...fieldProps
      } = fieldConfig;
      const asyncOptions = name ? asyncOptionsMap[name] : undefined;
      const mergedOptions = asyncOptions?.length
        ? asyncOptions
        : fieldConfig?.options;
      const span = expanded ? spanProps : 6;
      const isHidden = index >= collapseThreshold && !expanded;
      // 渲染 label，支持换行
      const renderLabel = () => {
        if (labelWrap) {
          return <span className={styles.labelWrap}>{label}</span>;
        }
        return label;
      };

      // 生成埋点处理函数
      const getReportHandlers = () => {
        if (!pageId || !clstagId || !name) {
          return {};
        }
        const eventId = `${clstagId}_${name}`;

        // 点击埋点处理函数
        const handleClickReport = () => {
          const currentValue = form.getFieldValue(name);
          dataReport(
            pageId,
            `${eventId}_click`,
            {
              needJSON: true,
              fieldName: name,
              fieldType: type,
              fieldValue:
                currentValue !== null && currentValue !== undefined
                  ? String(currentValue)
                  : "",
            },
            {},
          );
        };

        return { handleClickReport };
      };

      const { handleClickReport } = getReportHandlers();

      switch (type) {
        case "input": {
          const inputItemProps = (itemProps as any) || {};
          return (
            <Col
              span={span}
              key={name + index}
              className={styles.formCol}
              style={{ display: isHidden ? "none" : "block" }}
            >
              <Form.Item name={name} label={renderLabel()} {...fieldProps}>
                <Input
                  placeholder={placeholder as string}
                  onClick={handleClickReport}
                  onChange={inputItemProps?.onChange}
                  allowClear
                  {...inputItemProps}
                />
              </Form.Item>
            </Col>
          );
        }
        case "inputNumber": {
          const inputNumberItemProps = (itemProps as any) || {};
          return (
            <Col
              span={span}
              key={name + index}
              className={styles.formCol}
              style={{ display: isHidden ? "none" : "block" }}
            >
              <Form.Item name={name} label={renderLabel()} {...fieldProps}>
                <InputNumber
                  controls={false}
                  style={{ width: "100%" }}
                  placeholder={placeholder as string}
                  onClick={handleClickReport}
                  onChange={inputNumberItemProps?.onChange}
                  {...inputNumberItemProps}
                />
              </Form.Item>
            </Col>
          );
        }
        case "select": {
          const selectItemProps = (itemProps as any) || {};
          return (
            <Col
              span={span}
              key={name + index}
              className={styles.formCol}
              style={{ display: isHidden ? "none" : "block" }}
            >
              <Form.Item name={name} label={renderLabel()} {...fieldProps}>
                <Select
                  options={(mergedOptions as FormFieldOption[]) || []}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ width: "100%" }}
                  placeholder={placeholder as string}
                  onClick={handleClickReport}
                  onChange={selectItemProps?.onChange}
                  {...selectItemProps}
                />
              </Form.Item>
            </Col>
          );
        }
        case "selectAsync": {
          if (!fieldConfig?.getData) {
            console.error(
              `SelectAsync field "${name}" requires a getData function`,
            );
            return <div key={name + index}></div>;
          }
          const selectAsyncItemProps = (itemProps as any) || {};
          return (
            <Col
              span={span}
              key={name + index}
              className={styles.formCol}
              style={{ display: isHidden ? "none" : "block" }}
            >
              <Form.Item name={name} label={renderLabel()} {...fieldProps}>
                <SelectAsync
                  getData={getData as SelectAsyncGetData}
                  style={{ width: "100%" }}
                  placeholder={placeholder as string}
                  onClick={handleClickReport}
                  onChange={selectAsyncItemProps?.onChange}
                  {...selectAsyncItemProps}
                />
              </Form.Item>
            </Col>
          );
        }
        case "date": {
          const dateProps = (itemProps as any) || {};
          const format = dateProps.format || "YYYY-MM-DD";
          return (
            <Col
              span={span}
              key={name + index}
              className={styles.formCol}
              style={{ display: isHidden ? "none" : "block" }}
            >
              <Form.Item name={name} label={renderLabel()} {...fieldProps}>
                <DatePickerWrapper
                  style={{ width: "100%" }}
                  placeholder={placeholder as string}
                  format={format}
                  onClick={handleClickReport}
                  onChange={dateProps?.onChange}
                  {...dateProps}
                />
              </Form.Item>
            </Col>
          );
        }
        case "dateRange": {
          const dateRangeProps = (itemProps as any) || {};
          const format = dateRangeProps?.format || "YYYY-MM-DD";
          return (
            <Col
              span={span}
              key={name + index}
              className={styles.formCol}
              style={{ display: isHidden ? "none" : "block" }}
            >
              <Form.Item name={name} label={renderLabel()} {...fieldProps}>
                <DateRangePickerWrapper
                  style={{ width: "100%" }}
                  placeholder={
                    Array.isArray(placeholder) ? placeholder : undefined
                  }
                  format={format}
                  onClick={handleClickReport}
                  onChange={dateRangeProps?.onChange}
                  {...dateRangeProps}
                />
              </Form.Item>
            </Col>
          );
        }
        case "cascader": {
          const cascaderItemProps = (itemProps as any) || {};
          return (
            <Col
              span={span}
              key={name + index}
              className={styles.formCol}
              style={{ display: isHidden ? "none" : "block" }}
            >
              <Form.Item name={name} label={renderLabel()} {...fieldProps}>
                <Cascader
                  style={{ width: "100%" }}
                  options={(mergedOptions as CascaderOption[]) || []}
                  placeholder={placeholder as string}
                  onClick={handleClickReport}
                  onChange={cascaderItemProps?.onChange}
                  {...cascaderItemProps}
                />
              </Form.Item>
            </Col>
          );
        }
        case "numberRange": {
          const numberRangeItemProps = (itemProps as any) || {};
          return (
            <Col
              span={span}
              key={name + index}
              className={styles.formCol}
              style={{ display: isHidden ? "none" : "block" }}
            >
              <div onClick={handleClickReport}>
                <Form.Item name={name} label={renderLabel()} {...fieldProps}>
                  <NumberRangeInput
                    placeholder={fieldConfig?.placeholder}
                    itemProps={numberRangeItemProps}
                    valueFormatter={(value) => {
                      if (!value) return value;
                      return { ...value, fieldType: 2 };
                    }}
                    onChange={numberRangeItemProps?.onChange}
                  />
                </Form.Item>
              </div>
            </Col>
          );
        }
        case "selectRange": {
          const selectRangeItemProps = (itemProps as any) || {};
          return (
            <Col
              span={span}
              key={name + index}
              className={styles.formCol}
              style={{ display: isHidden ? "none" : "block" }}
            >
              <div onClick={handleClickReport}>
                <Form.Item name={name} label={renderLabel()} {...fieldProps}>
                  <SelectRange
                    placeholder={fieldConfig?.placeholder}
                    options={(mergedOptions as FormFieldOption[]) || []}
                    itemProps={selectRangeItemProps}
                    valueFormatter={(value) => {
                      if (!value) return value;
                      return { ...value, fieldType: 2 };
                    }}
                    onChange={selectRangeItemProps?.onChange}
                  />
                </Form.Item>
              </div>
            </Col>
          );
        }
        case "custom":
          return component ? (
            <Col
              span={span}
              key={name + index}
              className={styles.formCol}
              style={{ display: isHidden ? "none" : "block" }}
              onClick={handleClickReport}
            >
              <Form.Item name={name} label={renderLabel()} {...fieldProps}>
                {component}
              </Form.Item>
            </Col>
          ) : (
            <div key={name + index}>{type}</div>
          );
        default:
          return <div key={name + index}></div>;
      }
    };

    // 获取要显示的字段（支持“字段选择” + 折叠时只显示前 collapseThreshold 个）
    const fieldMap = new Map((fields || []).map((f) => [f.name, f]));
    const selectedFields = (() => {
      if (!enableFieldSetting) return fields || [];
      const names =
        Array.isArray(fieldOrder) && fieldOrder.length
          ? fieldOrder
          : defaultFieldOrder;
      return names
        .map((name) => fieldMap.get(name))
        .filter(Boolean) as FormFieldConfig[];
    })();
    const visibleFields = selectedFields;
    const showCollapse = selectedFields?.length > collapseThreshold;
    // 从 rest 中排除 form 属性，避免类型冲突
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { form: _formFromRest, ...formRest } = rest;
    const handleSubmitClick = () => {
      // 查询按钮点击埋点
      if (pageId && clstagId) {
        const eventId = `${clstagId}_search`;
        dataReport(
          pageId,
          eventId,
          {
            needJSON: true,
            searchParams: form.getFieldsValue() || {},
          },
          {},
        );
      }
      handleSubmit();
    };
    const handleResetClick = () => {
      // 重置按钮点击埋点
      if (pageId && clstagId) {
        const eventId = `${clstagId}_reset`;
        dataReport(
          pageId,
          eventId,
          {
            needJSON: true,
          },
          {},
        );
      }
      handleReset();
    };
    /**
     * 字段选择入口点击
     * @returns {void}
     */
    const handleFieldSettingClick = () => {
      if (pageId && clstagId) {
        const eventId = `${clstagId}_fieldSetting`;
        dataReport(
          pageId,
          eventId,
          {
            needJSON: true,
            action: "open",
          },
          {},
        );
      }
      setFieldSettingOpen(true);
    };

    /**
     * 展开/收起按钮点击
     * @returns {void}
     */
    const handleToggleExpandedClick = () => {
      if (pageId && clstagId) {
        const eventId = `${clstagId}_expandToggle`;
        dataReport(
          pageId,
          eventId,
          {
            needJSON: true,
            action: expanded ? "collapse" : "expand",
          },
          {},
        );
      }
      toggleExpanded();
    };
    const renderButtons = () => {
      return (
        <div className={`${styles.formColButtons} ${styles.flow}`}>
          <Button onClick={handleResetClick} className={styles.btn}>
            重置
          </Button>
          <Button
            type="primary"
            ghost
            onClick={handleSubmitClick}
            className={styles.btn}
          >
            查询
          </Button>
          {enableFieldSetting && (
            <Tooltip title="字段选择">
              <Button
                className={styles.fieldSettingButton}
                onClick={handleFieldSettingClick}
              >
                <SettingOutlined />
              </Button>
            </Tooltip>
          )}
          {extraActions}
          {showCollapse && (
            <span
              className={styles.foldButton}
              onClick={handleToggleExpandedClick}
            >
              {/* 收起 */}
              <span>
                {expanded ? (
                  <UpOutlined className={styles.upIcon} />
                ) : (
                  <DownOutlined className={styles.downIcon} />
                )}
              </span>
            </span>
          )}
        </div>
      );
    };
    return (
      <Form<FormValues>
        form={form}
        className={`${styles.formWrapper} ${className || ""}`}
        style={
          {
            "--expand-label-width": expandLabelWidth,
            "--col-padding-left": expanded ? "0px" : "8px",
          } as React.CSSProperties
        }
        initialValues={initialValues}
        onFinish={handleFinish}
        onValuesChange={handleValuesChange}
        onKeyDown={handleKeyDown}
        labelAlign={rest?.labelAlign || "right"}
        autoComplete={rest?.autoComplete || "off"}
        colon={rest?.colon || false}
        {...formRest}
        labelCol={{
          style: {
            width: expanded ? expandLabelWidth : "auto",
            ...rest?.labelCol?.style,
          },
          ...rest?.labelCol,
        }}
      >
        <Row className={styles.customRow} gutter={18}>
          <Col
            className={`${styles.formColContent} ${showCollapse && styles.expand}`}
          >
            <Row gutter={36} className={styles.formColContentRow}>
              {visibleFields?.map(renderField)}
              {expanded && renderButtons()}
            </Row>
            {!expanded && renderButtons()}
          </Col>
        </Row>
        {enableFieldSetting && (
          <QueryFieldSettingModal
            open={fieldSettingOpen}
            options={(fields || []).map((f) => ({
              field: f.name,
              label: f.label,
              required: disabledHideFields.includes(f.name),
            }))}
            value={
              (Array.isArray(fieldOrder) && fieldOrder.length
                ? fieldOrder
                : defaultFieldOrder
              )
                .map((name) => {
                  const f = fieldMap.get(name);
                  return f
                    ? {
                        field: f.name,
                        label: f.label,
                        required: disabledHideFields.includes(f.name),
                      }
                    : null;
                })
                .filter(Boolean) as any
            }
            defaultValue={(fields || []).map((f) => ({
              field: f.name,
              label: f.label,
              required: disabledHideFields.includes(f.name),
            }))}
            onCancel={() => {
              if (pageId && clstagId) {
                const eventId = `${clstagId}_fieldSettingCancel`;
                dataReport(pageId, eventId, { needJSON: true }, {});
              }
              setFieldSettingOpen(false);
            }}
            onChange={(next) => {
              const nextOrder = next.map((it) => it.field);
              if (pageId && clstagId) {
                const eventId = `${clstagId}_fieldSettingOk`;
                dataReport(
                  pageId,
                  eventId,
                  {
                    needJSON: true,
                    fieldOrder: nextOrder,
                  },
                  {},
                );
              }
              setFieldOrder(nextOrder);
              if (enableFieldSetting && fieldSettingCacheKey) {
                const cacheKey = getFieldSettingCacheKey(fieldSettingCacheKey);
                if (cacheKey)
                  persistFieldSettingCache(
                    cacheKey,
                    defaultFieldOrder,
                    nextOrder,
                  );
              }
              setFieldSettingOpen(false);
            }}
          />
        )}
      </Form>
    );
  },
);

SearchTableForm.displayName = "TableForm";

export default SearchTableForm;
