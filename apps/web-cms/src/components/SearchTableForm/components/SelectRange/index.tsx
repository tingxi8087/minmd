import React, { useMemo } from 'react';

import { Select, SelectProps } from 'antd';

import { FormFieldOption } from '../../index';

import styles from './index.module.less';

export type SelectRangeValue = {
  leftValue?: string | number;
  rightValue?: string | number;
  [key: string]: any;
};

export type SelectRangePlaceholder = string | [string, string] | undefined;

export interface SelectRangeInputProps {
  value?: SelectRangeValue | [string | number | undefined, string | number | undefined]; // 值
  onChange?: (value?: SelectRangeValue) => void; // 值变化回调
  placeholder?: SelectRangePlaceholder; // 占位符
  options?: FormFieldOption[]; // 下拉选项
  itemProps?: SelectProps<string | number | null, FormFieldOption>; // Select 属性
  valueFormatter?: (value: SelectRangeValue) => SelectRangeValue; // 值格式化
}

/**
 * SelectRange 组件
 * @param {SelectRangeInputProps} props - 组件的属性
 * @param {SelectRangeValue} props.value - 值
 * @param {Function} props.onChange - 值变化回调
 * @param {SelectRangePlaceholder} props.placeholder - 占位符
 * @param {FormFieldOption[]} props.options - 下拉选项
 * @param {React.ComponentProps<typeof Select>} props.itemProps - Select 属性
 * @param {Function} props.valueFormatter - 值格式化
 */
const SelectRange: React.FC<SelectRangeInputProps> = ({
  value,
  onChange,
  placeholder,
  options = [],
  itemProps,
  valueFormatter
}) => {
  // 合并值
  const mergedValue: SelectRangeValue = Array.isArray(value)
    ? { leftValue: value[0], rightValue: value[1] }
    : value || {};

  // 占位符
  const [startPlaceholder, endPlaceholder] = useMemo(() => {
    if (Array.isArray(placeholder)) {
      return placeholder;
    }
    return [placeholder || '请选择', placeholder || '请选择'];
  }, [placeholder]);

  // 触发值变化
  const triggerChange = (changedValue: Partial<SelectRangeValue>) => {
    // 值格式化
    const nextValue = valueFormatter
      ? valueFormatter({
          ...mergedValue,
          ...changedValue
        })
      : {
          ...mergedValue,
          ...changedValue
        };
    if (
      (nextValue.leftValue === undefined || nextValue.leftValue === null) &&
      (nextValue.rightValue === undefined || nextValue.rightValue === null)
    ) {
      onChange?.(undefined);
      return;
    }
    onChange?.(nextValue);
  };

  // 处理左值变化
  const handleLeftChange = (val: string | number | null) => {
    triggerChange({ leftValue: val === null ? undefined : val });
  };

  // 处理右值变化
  const handleRightChange = (val: string | number | null) => {
    triggerChange({ rightValue: val === null ? undefined : val });
  };

  // 共享属性
  const sharedProps: SelectProps<string | number | null, FormFieldOption> = {
    allowClear: true,
    showSearch: true,
    optionFilterProp: 'label',
    style: { width: '100%' },
    ...(itemProps || {})
  };

  return (
    <div className={styles.selectRange}>
      <Select
        {...sharedProps}
        options={options}
        placeholder={startPlaceholder}
        value={mergedValue.leftValue}
        onChange={handleLeftChange}
      />
      <span className={styles.rangeSeparator}>-</span>
      <Select
        {...sharedProps}
        options={options}
        placeholder={endPlaceholder}
        value={mergedValue.rightValue}
        onChange={handleRightChange}
      />
    </div>
  );
};

export default SelectRange;
