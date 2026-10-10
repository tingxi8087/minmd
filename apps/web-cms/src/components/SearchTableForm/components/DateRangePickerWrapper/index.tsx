import React from 'react';

import { DatePicker } from 'antd';

import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

/**
 * 日期范围选择器包装组件
 * 将 dayjs 对象数组转换为字符串数组，根据 format 进行格式化
 */
export interface DateRangePickerWrapperProps
  extends Omit<React.ComponentProps<typeof RangePicker>, 'value' | 'onChange'> {
  /** 值（字符串数组格式） */
  value?: [string, string] | null;
  /** 值变化回调（返回字符串数组格式） */
  onChange?: (value: [string, string] | null) => void;
  /** 日期格式，默认为 'YYYY-MM-DD' */
  format?: string;
}

const DateRangePickerWrapper: React.FC<DateRangePickerWrapperProps> = ({
  value,
  onChange,
  format = 'YYYY-MM-DD',
  ...restProps
}) => {
  // 将字符串数组转换为 dayjs 对象数组用于显示
  let dayjsValue: [Dayjs, Dayjs] | null = null;
  if (value && Array.isArray(value) && value.length === 2) {
    const [start, end] = value;
    if (start && end) {
      const startDayjs = dayjs(start);
      const endDayjs = dayjs(end);
      if (startDayjs.isValid() && endDayjs.isValid()) {
        dayjsValue = [startDayjs, endDayjs];
      }
    }
  }

  // 处理值变化，将 dayjs 对象数组转换为字符串数组
  const handleChange = (dates: [Dayjs | null, Dayjs | null] | null) => {
    if (onChange) {
      if (!dates || !dates[0] || !dates[1]) {
        onChange(null);
        return;
      }
      onChange([dates[0].format(format), dates[1].format(format)]);
    }
  };

  return <RangePicker value={dayjsValue} onChange={handleChange} format={format} {...restProps} />;
};

export default DateRangePickerWrapper;

