import React, { useMemo } from 'react';

import { InputNumber } from 'antd';

import styles from './index.module.less';

export type NumberRangeValue = {
  leftValue?: number;
  rightValue?: number;
  [key: string]: any;
};

export type NumberRangePlaceholder = string | [string, string] | undefined;

export interface NumberRangeInputProps {
  value?: NumberRangeValue | [number | undefined, number | undefined]; // 值
  onChange?: (value?: NumberRangeValue) => void; // 值变化回调
  placeholder?: NumberRangePlaceholder; // 占位符
  itemProps?: React.ComponentProps<typeof InputNumber>; // 输入框属性
  valueFormatter?: (value: NumberRangeValue) => NumberRangeValue; // 值格式化
}

/**
 * NumberRangeInput 组件
 * @param {NumberRangeInputProps} props - 组件的属性
 * @param {NumberRangeValue} props.value - 值
 * @param {Function} props.onChange - 值变化回调
 * @param {NumberRangePlaceholder} props.placeholder - 占位符
 * @param {React.ComponentProps<typeof InputNumber>} props.itemProps - 输入框属性
 * @param {Function} props.valueFormatter - 值格式化
 */
const NumberRangeInput: React.FC<NumberRangeInputProps> = ({
  value,
  onChange,
  placeholder,
  itemProps,
  valueFormatter
}) => {

  // 合并值
  const mergedValue: NumberRangeValue = Array.isArray(value)
    ? { leftValue: value[0], rightValue: value[1] }
    : value || {};

  // 占位符
  const [startPlaceholder, endPlaceholder] = useMemo(() => {
    if (Array.isArray(placeholder)) {
      return placeholder;
    }
    return [placeholder || '最小值', placeholder || '最大值'];
  }, [placeholder]);

  // 触发值变化
  const triggerChange = (changedValue: Partial<NumberRangeValue>) => {
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
    triggerChange({ leftValue: typeof val === 'number' ? val : val === null ? undefined : Number(val) });
  };

  // 处理右值变化
  const handleRightChange = (val: string | number | null) => {
    triggerChange({ rightValue: typeof val === 'number' ? val : val === null ? undefined : Number(val) });
  };


  // 共享样式
  const sharedStyle = { width: '100%', ...(itemProps?.style || {}) };
  // 共享属性
  const sharedProps: React.ComponentProps<typeof InputNumber> = {
    controls: false,
    ...(itemProps || {}),
    style: sharedStyle
  };

  return (
    <div className={styles.numberRange}>
      <InputNumber
        {...sharedProps}
        placeholder={startPlaceholder}
        value={mergedValue.leftValue}
        onChange={handleLeftChange}
      />
      <span className={styles.rangeSeparator}>-</span>
      <InputNumber
        {...sharedProps}
        placeholder={endPlaceholder}
        value={mergedValue.rightValue}
        onChange={handleRightChange}
      />
    </div>
  );
};

export default NumberRangeInput;


