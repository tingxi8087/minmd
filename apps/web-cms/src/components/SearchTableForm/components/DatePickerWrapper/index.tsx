import React from 'react';

import { DatePicker, DatePickerProps } from 'antd';

import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';

/**
 * 日期选择器包装组件
 * 将 dayjs 对象转换为字符串，根据 format 进行格式化
 */
export interface DatePickerWrapperProps extends Omit<DatePickerProps, 'value' | 'onChange'> {
  /** 值（字符串格式） */
  value?: string | null;
  /** 值变化回调（返回字符串格式） */
  onChange?: (value: string | null) => void;
  /** 日期格式，默认为 'YYYY-MM-DD' */
  format?: string;
}

const DatePickerWrapper: React.FC<DatePickerWrapperProps> = ({
  value,
  onChange,
  format = 'YYYY-MM-DD',
  ...restProps
}) => {
  // 将字符串转换为 dayjs 对象用于显示
  let dayjsValue: Dayjs | null = null;
  if (value) {
    const dayjsObj = dayjs(value);
    dayjsValue = dayjsObj.isValid() ? dayjsObj : null;
  }

  // 处理值变化，将 dayjs 对象转换为字符串
  const handleChange = (date: Dayjs | null) => {
    if (onChange) {
      onChange(date ? date.format(format) : null);
    }
  };

  return <DatePicker value={dayjsValue} onChange={handleChange} format={format} {...restProps} />;
};

export default DatePickerWrapper;

