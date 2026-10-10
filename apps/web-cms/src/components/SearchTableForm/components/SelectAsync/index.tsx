import React, { useEffect, useRef, useState } from 'react';

import { Select, SelectProps } from 'antd';

import styles from './index.module.less';

// 这是UUid
const getUUId = () => {
  let d = new Date().getTime();
  const uuid = 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = ((d + Math.random() * 16) % 16) | 0;
    d = Math.floor(d / 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
  return uuid;
};
// 标准选项数据格式
interface ISelectOption {
  value: string | number;
  label: string;
  [key: string]: any; // 允许其他额外属性
}

interface ISelectAsync extends Omit<SelectProps, 'loading' | 'optionRender'> {
  /** 数据获取函数，必须返回标准格式的选项数组 */
  getData: (value: string) => Promise<ISelectOption[]>;
  /** 是否在组件挂载时立即加载数据，默认为 fasle */
  loadDataOnMount?: boolean;
  /** 搜索防抖延迟时间（毫秒），默认为 300 */
  debounceDelay?: number;
  /** 是否显示加载状态，默认为 true */
  showLoading?: boolean;
  /** 自定义选项渲染函数 */
  optionRender?: (option: ISelectOption) => React.ReactNode;
  /** 搜索时的最小字符数，默认为 0 */
  minSearchLength?: number;
  /** 是否在搜索时清空之前的结果，默认为 false */
  clearOnSearch?: boolean;
  /** 自定义 埋点 */
  clstag?: string;
  /** 下拉框最大宽度 */
  popupMaxWidth?: string;
}

const SelectAsync: React.FC<ISelectAsync> = ({
  getData,
  loadDataOnMount = false,
  debounceDelay = 300,
  showLoading = true,
  optionRender,
  minSearchLength = 0,
  clearOnSearch = true,
  onSearch,
  popupMaxWidth,
  ...restProps
}) => {
  const [options, setOptions] = useState<ISelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  /** 标记是否已经执行过搜索/加载数据，用于判断下拉框打开时是否需要重新加载 */
  const hasSearchedRef = useRef(false);
  const reqId = useRef(getUUId());
  /**
   * 加载数据的函数
   * @param searchText 搜索关键词
   * @param newReqId 请求ID，用于防止并发请求导致的数据覆盖
   */
  const loadData = async (searchText = '', newReqId: string) => {
    try {
      setLoading(true);
      const data = await getData(searchText);
      if (reqId.current !== newReqId) return;
      setOptions(data || []);
      // 标记已执行过数据加载，用于 handleDropdownVisibleChange 判断是否需要重新加载
      hasSearchedRef.current = true;
    } catch (error) {
      console.error('SelectAsync loadData error:', error);
      setOptions([]);
    } finally {
      setLoading(false);
    }
  };
  const debounceTimer = useRef<any>(null);
  // 防抖搜索函数
  const debouncedSearch = (searchText: string) => {
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      reqId.current = getUUId();
      if (searchText?.length >= minSearchLength) {
        loadData(searchText, reqId.current);
        hasSearchedRef.current = true;
      } else if (clearOnSearch && hasSearchedRef.current) {
        setOptions([]);
      }
    }, debounceDelay);
  };

  // 组件挂载时加载数据
  useEffect(() => {
    if (loadDataOnMount) {
      reqId.current = getUUId();
      loadData('', reqId.current);
    }
  }, [loadDataOnMount]);

  // 处理搜索
  const handleSearch = (value: string) => {
    onSearch?.(value);
    if (value?.length >= minSearchLength) {
      debouncedSearch(value);
    } else if (clearOnSearch && hasSearchedRef.current) {
      setOptions([]);
    }
  };

  /**
   * 处理下拉框打开/关闭
   * 修复问题：当 loadDataOnMount 为 true 时，用户清除选择后再次打开下拉框，选项为空导致无法展示数据
   * 解决方案：下拉框打开时，如果选项为空，则重新加载数据
   * @param open 下拉框是否打开
   */
  const handleDropdownVisibleChange = (open: boolean) => {
    if (open) {
      // 如果选项为空（可能是用户清除后导致的），则重新加载数据
      // 或者从未搜索过且不是挂载时加载的场景，则加载数据
      if (options.length === 0 || (!hasSearchedRef.current && !loadDataOnMount)) {
        reqId.current = getUUId();
        loadData('', reqId.current);
        // 注意：loadData 内部会设置 hasSearchedRef.current = true，这里重复设置是为了确保状态正确
        hasSearchedRef.current = true;
      }
    }
  };

  // 渲染选项
  const renderOptions = () => {
    return options?.map((option, index) => {
      return (
        <Select.Option
          key={`${option?.value || ''}-${index}`}
          value={option?.value}
          title={option?.label}
          itemObj={option?.itemObj}
        >
          {optionRender ? optionRender(option) : option?.label}
        </Select.Option>
      );
    });
  };

  return (
    <Select
      showSearch
      loading={showLoading && loading}
      popupMatchSelectWidth={false} // 下拉框宽度自适应
      allowClear
      /**
       * 处理清除操作
       * 修复问题：用户清除选择后，hasSearchedRef 仍为 true，导致再次打开下拉框时不会重新加载数据
       * 解决方案：清除时重置 hasSearchedRef 为 false，确保下次打开下拉框时能重新加载数据
       */
      onClear={() => {
        setOptions([]);
        // 清除后重置搜索状态，以便下次打开下拉框时 handleDropdownVisibleChange 能检测到并重新加载数据
        hasSearchedRef.current = false;
      }}
      getPopupContainer={(node) => {
        // 优先使用传入的 getPopupContainer，否则使用 document.body 确保定位正确
        if (restProps?.getPopupContainer) {
          return restProps?.getPopupContainer(node);
        }
        return document.body;
      }}
      onSearch={handleSearch}
      onDropdownVisibleChange={handleDropdownVisibleChange}
      filterOption={false} // 禁用默认过滤，使用自定义搜索
      notFoundContent={null}
      {...restProps}
      popupClassName={
        restProps?.popupClassName
          ? `${restProps.popupClassName} ${styles.forceBottom}`
          : styles.forceBottom
      }
      placement={restProps?.placement || 'bottomLeft'} // 强制向下展开，避免向上展开导致看不全数据，但允许外部覆盖
      style={{
        ...restProps.style,
        maxWidth: popupMaxWidth || restProps.style?.maxWidth
      }}
      dropdownStyle={{
        maxHeight: 400,
        overflow: 'auto',
        ...restProps.dropdownStyle
      }}
    >
      {renderOptions()}
    </Select>
  );
};

export default SelectAsync;
