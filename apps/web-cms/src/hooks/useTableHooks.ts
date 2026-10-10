import React, { DependencyList, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useResource, ResourceOptions } from "./useResource";
import { useRefState } from "./useRefState";

export type GetTableDataResult<TData, TMeta = unknown> = {
  data: TData[]; total: number; pageNum?: number; pageSize?: number;
  render?: boolean; meta?: TMeta;
};
export type GetTableDataFn<TData> = () => Promise<GetTableDataResult<TData>>;
export type UpdateGetTableDataByIdFn = (idArr: string[]) => Promise<any[]>;
export type TableQuery<T> = { pageNum: number; pageSize: number; searchParams: T };
type TableOptions<TData, TSearchParams, TMeta> = {
  defaultPageSize?: number;
  cachePageSizeKey?: string;
  getTableData: (query: TableQuery<TSearchParams>) => Promise<GetTableDataResult<TData, TMeta>>;
  debounceTime?: number;
  deps?: DependencyList;
  subscribe?: ResourceOptions["subscribe"];
} & ({ query: TableQuery<TSearchParams>; onQueryChange: (query: TableQuery<TSearchParams>) => void }
  | { query?: undefined; onQueryChange?: undefined });

function storedPageSize(key: string | undefined, fallback: number) {
  if (!key) return fallback;
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null")?.value;
    return Number.isInteger(value) && value > 0 ? value : fallback;
  } catch { return fallback; }
}

export function useBasePageTable<TData = any, TSearchParams = any, TMeta = unknown>(
  options: TableOptions<TData, TSearchParams, TMeta>,
) {
  const { defaultPageSize = 20, cachePageSizeKey, debounceTime = 200 } = options;
  const [internalQuery, setInternalQuery, queryRef] = useRefState<TableQuery<TSearchParams>>(() => ({
    pageNum: 1, pageSize: storedPageSize(cachePageSizeKey, defaultPageSize), searchParams: {} as TSearchParams,
  }));
  const query = options.query ?? internalQuery;
  const latest = useRef(options);
  latest.current = options;
  const change = useCallback((update: (query: TableQuery<TSearchParams>) => TableQuery<TSearchParams>) => {
    const current = latest.current;
    if (current.query) current.onQueryChange(update(current.query));
    else setInternalQuery(update(queryRef.current));
  }, [setInternalQuery, queryRef]);
  const resource = useResource(() => options.getTableData(query),
    [query.pageNum, query.pageSize, query.searchParams, ...(options.deps || [])],
    { delay: debounceTime, subscribe: options.subscribe });
  const [result, setResult] = useState<GetTableDataResult<TData, TMeta>>();
  useEffect(() => {
    if (resource.error) { setResult(undefined); return; }
    const next = resource.data;
    if (!next || next.render === false) return;
    setResult(next);
    const pageNum = next.pageNum ?? query.pageNum;
    const pageSize = next.pageSize ?? query.pageSize;
    if (pageNum !== query.pageNum || pageSize !== query.pageSize) {
      change(current => ({ ...current, pageNum, pageSize }));
    }
  }, [resource.data, resource.error]);
  useEffect(() => {
    if (!cachePageSizeKey) return;
    try { localStorage.setItem(cachePageSizeKey, JSON.stringify({ value: query.pageSize })); }
    catch { /* 页容量缓存失败不阻断查询。 */ }
  }, [cachePageSizeKey, query.pageSize]);
  const setPageNum = useCallback<React.Dispatch<React.SetStateAction<number>>>(value => {
    change(q => ({ ...q, pageNum: typeof value === "function" ? value(q.pageNum) : value }));
  }, [change]);
  const setPageSize = useCallback<React.Dispatch<React.SetStateAction<number>>>(value => {
    change(q => {
      const pageSize = typeof value === "function" ? value(q.pageSize) : value;
      return pageSize === q.pageSize ? q : { ...q, pageNum: 1, pageSize };
    });
  }, [change]);
  const setSearchParams = useCallback<React.Dispatch<React.SetStateAction<TSearchParams>>>(value => {
    change(q => ({ ...q, pageNum: 1, searchParams: typeof value === "function" ? (value as (p: TSearchParams) => TSearchParams)(q.searchParams) : value }));
  }, [change]);
  const setTableData = useCallback<React.Dispatch<React.SetStateAction<TData[]>>>(value => {
    setResult(previous => ({ ...previous, total: previous?.total || 0,
      data: typeof value === "function" ? value(previous?.data || []) : value }));
  }, []);
  const setTotal = useCallback<React.Dispatch<React.SetStateAction<number>>>(value => {
    setResult(previous => ({ ...previous, data: previous?.data || [],
      total: typeof value === "function" ? value(previous?.total || 0) : value }));
  }, []);
  return { ...query, setPageNum, setPageSize, setSearchParams,
    tableData: result?.data || [], setTableData, total: result?.total || 0, setTotal,
    data: result, error: resource.error, loading: resource.loading,
    setLoading: resource.setLoading, reloadTable: resource.reload };
}
export type UseBasePageTableReturn<TData, TSearchParams> = ReturnType<typeof useBasePageTable<TData, TSearchParams>>;

/**
 * 根据 id 列表刷新表格局部数据
 */
export const useReloadDataById = ({
  getTableDataById,
  setTableData,
  idName
}: {
  getTableDataById: UpdateGetTableDataByIdFn;
  setTableData: React.Dispatch<React.SetStateAction<any[]>>;
  idName: string;
}) => {
  const reloadDataById = (idArr: string[]) => {
    getTableDataById(idArr).then((data) => {
      setTableData(rows => rows.map(row => {
        const updated = data.find(item => item[idName] === row[idName]);
        return updated ? { ...row, ...updated } : row;
      }));
    });
  };
  return reloadDataById;
};

/**
 * useTableChecked 的配置
 */
type UseTableCheckedOptions<TData> = {
  tableData: TData[];
  setTableData: React.Dispatch<React.SetStateAction<TData[]>>;
  idName: string;
};

/**
 * useTableChecked 的返回结构
 */
export type UseTableCheckedReturn<TData> = {
  // 根据 id 切换选中状态
  toggleChecked: (id?: string | number) => void;
  // 批量设置选中状态
  changeChecked: (ids: (string | number)[], checked: boolean) => void;
  // 全选/取消全选（根据当前选中态判断）
  handleSelectAll: () => void;
  // 已选中的 id 数组
  checkedIds: (string | number)[];
  // 已选中的项数组
  checkedItems: TData[];
  // 是否全选
  isAllChecked: boolean;
  // 已选中数量
  checkedCount: number;
  // 是否半选（部分选中）
  isIndeterminate: boolean;
};

/**
 * 管理表格多选状态的 hook
 */
export const useTableChecked = <TData extends Record<string, any> = any>({
  tableData = [],
  setTableData = () => undefined,
  idName
}: UseTableCheckedOptions<TData>): UseTableCheckedReturn<TData> => {
  // 根据 id 切换选中状态
  const toggleChecked = (id?: string | number) => {
    if (id === undefined || id === null) return;
    setTableData((prevData) =>
      prevData?.map((item) => (item?.[idName] === id ? { ...item, _checked: !(item?._checked ?? false) } : item))
    );
  };

  // 批量设置选中状态
  const changeChecked = (ids: (string | number)[], checked: boolean) => {
    setTableData((prevData) =>
      prevData?.map((item) => (ids?.includes(item?.[idName]) ? { ...item, _checked: checked } : item))
    );
  };

  // 全选/取消全选（根据当前选中态判断）
  const handleSelectAll = () => {
    setTableData((prevData) => {
      const allChecked = prevData?.length > 0 && prevData?.every((item) => (item?._checked ?? false) === true);
      return prevData?.map((item) => ({ ...item, _checked: !allChecked }));
    });
  };

  // 选中态派生值（使用 useMemo 避免重复计算与多余渲染）
  const { isAllChecked, checkedCount, checkedIds, checkedItems, isIndeterminate } = useMemo(() => {
    const checked = tableData?.filter((item) => (item?._checked ?? false) === true) || [];
    const ids = checked?.map((item) => item?.[idName]) ?? [];
    const count = checked?.length ?? 0;
    const allChecked = (tableData?.length ?? 0) > 0 && count === (tableData?.length ?? 0);
    const indeterminate = count > 0 && !allChecked;
    return {
      isAllChecked: allChecked,
      checkedCount: count,
      checkedIds: ids,
      checkedItems: checked,
      isIndeterminate: indeterminate
    };
  }, [tableData, idName]);

  return {
    toggleChecked,
    changeChecked,
    handleSelectAll,
    checkedIds,
    checkedItems,
    isAllChecked,
    checkedCount,
    isIndeterminate
  };
};

/**
 * useGetIndexById 的配置
 */
type UseGetIndexByIdOptions<TData> = {
  tableData: TData[];
  idName: string;
};

/**
 * 根据 id 获取索引的 hook
 */
export const useGetIndexById = <TData extends Record<string, any> = any>({
  tableData = [],
  idName
}: UseGetIndexByIdOptions<TData>) => {
  const tableDataRef = useRef(tableData);
  useEffect(() => {
    tableDataRef.current = tableData;
  }, [tableData]);
  const getIndexById = (id: string | number): number => {
    return tableDataRef?.current?.findIndex?.((item) => item[idName] === id);
  };
  return getIndexById;
};

/**
 * 通过 id 复制表格数据的 hook
 */
export const useCopyDataByIds = <TData extends Record<string, any> = any>(
  tableData: TData[],
  setTableData: React.Dispatch<React.SetStateAction<TData[]>>,
  idName: string
) => {
  const getIndexById = useGetIndexById<TData>({
    tableData: tableData,
    idName
  });
  const copyDataById = (ids: string[]) => {
    const newData: TData[] = [];
    try {
      ids?.forEach((id, iIndex) => {
        const index = getIndexById(id);
        if (index !== -1) {
          const item = {
            ...JSON.parse(JSON.stringify(tableData[index])),
            [idName]: `${tableData?.[index]?.[idName]}-copy-${Date.now()}-${iIndex}`,
            _checked: false
          } as TData;
          newData.push(item);
        }
      });
    } catch (error) {
      console.error('复制失败:', error);
    }
    setTableData((prev: TData[]) => [...newData, ...prev]);
  };
  return copyDataById;
};

/**
 * 在表格开头新增一行的 hook
 * @param setTableData - 设置表格数据的函数
 * @param totalRowInitialData - 所有新行的初始数据
 * @returns 新增行的函数
 */
/**
 * 在表格开头新增一行的 hook
 */
export const useAddRowAtStart = <TData extends Record<string, any> = any>(
  setTableData: React.Dispatch<React.SetStateAction<TData[]>>,
  idName: string,
  totalRowInitialData?: Partial<TData>
) => {
  const addRowAtStart = (len = 1, initialData?: Partial<TData>) => {
    const newRows: TData[] = [];
    for (let i = 0; i < len; i++) {
      newRows.push({
        [idName]: `new-${Date.now()}-${i}-${crypto.randomUUID()}`,
        ...(totalRowInitialData || {}),
        ...(initialData || {})
      } as unknown as TData);
    }
    setTableData((prev: TData[]) => [...newRows, ...prev]);
  };

  return addRowAtStart;
};

/**
 * 在表格末尾新增一行的 hook
 * @param setTableData - 设置表格数据的函数
 * @param idName - id 字段名
 * @param totalRowInitialData - 所有新行的初始数据
 * @returns 新增行的函数
 */
/**
 * 在表格末尾新增一行的 hook
 */
export const useAddRowAtEnd = <TData extends Record<string, any> = any>(
  setTableData: React.Dispatch<React.SetStateAction<TData[]>>,
  idName: string,
  totalRowInitialData?: Partial<TData>
) => {
  const addRowAtEnd = (len = 1, initialData?: Partial<TData>) => {
    const newRows: TData[] = [];
    for (let i = 0; i < len; i++) {
      newRows.push({
        [idName]: `new-${Date.now()}-${i}-${crypto.randomUUID()}`,
        ...(totalRowInitialData || {}),
        ...(initialData || {})
      } as unknown as TData);
    }
    setTableData((prev: TData[]) => [...prev, ...newRows]);
  };

  return addRowAtEnd;
};

/**
 * 通过 ids 批量删除表格数据的 hook
 * @param setTableData - 设置表格数据的函数
 * @param idName - id 字段名
 * @returns 删除数据的函数
 */
export const useDeleteDataByIds = <TData extends Record<string, any> = any>(
  setTableData: React.Dispatch<React.SetStateAction<TData[]>>,
  idName: string
) => {
  /**
   * 通过 ids 批量删除数据
   * @param ids - 要删除的 id 数组
   */
  const deleteDataByIds = (ids: (string | number)[]) => {
    setTableData((prev: TData[]) => prev?.filter((item: TData) => !ids?.includes(item?.[idName])));
  };
  return deleteDataByIds;
};
