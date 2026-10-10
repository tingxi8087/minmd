import { act, createElement, StrictMode, useRef, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useBasePageTable, useTableChecked, useReloadDataById } from "@/hooks/useTableHooks";
import { useRefState } from "@/hooks/useRefState";
import { useResource } from "@/hooks/useResource";
import { useElementBottomDistance } from "@/hooks/useElementBottomDistance";
let roots: Root[] = [];
function renderHook<T>(callback: () => T) {
  let value: T;
  const root = createRoot(document.createElement("div")); roots.push(root);
  function Probe() { value = callback(); return null; }
  const render = () => act(() => root.render(createElement(StrictMode, null, createElement(Probe))));
  render();
  return { get current() { return value!; }, rerender: render, unmount: () => { act(() => root.unmount()); roots = roots.filter(r => r !== root); } };
}
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes,no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { roots.forEach(root => act(() => root.unmount())); roots = []; vi.useRealTimers(); vi.unstubAllGlobals(); });

it("ref 与 state 在同一事件内连续函数更新保持一致", () => {
  const hook = renderHook(() => useRefState(0));
  act(() => { hook.current[1](n => n+1); hook.current[1](n => n+1); expect(hook.current[2].current).toBe(2); });
  expect(hook.current[0]).toBe(2);
});
it("旧请求不能覆盖 loading 或最新数据，失败可恢复", async () => {
  let key = 1; const first = deferred<number>(); const second = deferred<number>();
  const hook = renderHook(() => useResource(() => key === 1 ? first.promise : second.promise, [key]));
  await flush(); key = 2; hook.rerender(); await flush();
  await act(async () => first.resolve(1)); expect(hook.current.loading).toBe(true); expect(hook.current.data).toBeUndefined();
  await act(async () => second.reject(new Error("offline"))); expect(hook.current.loading).toBe(false); expect(hook.current.error).toBeInstanceOf(Error);
  key = 1; hook.rerender(); await flush(); expect(hook.current.data).toBe(1); expect(hook.current.error).toBeUndefined();
});
it("卸载清理防抖计时器和外部订阅", async () => {
  const fetcher = vi.fn(async () => 1); const unsubscribe = vi.fn(); const subscribe = vi.fn(() => unsubscribe);
  const hook = renderHook(() => useResource(fetcher, [], { delay: 200, subscribe }));
  hook.unmount(); await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(fetcher).not.toHaveBeenCalled(); expect(unsubscribe).toHaveBeenCalledTimes(subscribe.mock.calls.length);
});
it("查询和页容量变更回到第一页，相同页容量保留翻页结果", async () => {
  const fetcher = vi.fn(async (q: any) => ({ data: [q.pageNum], total: 30 }));
  const hook = renderHook(() => useBasePageTable<number, { keyword?: string }>({ getTableData: fetcher, debounceTime: 0 }));
  await flush(); act(() => hook.current.setPageNum(3)); await flush(); expect(hook.current.tableData).toEqual([3]);
  act(() => { hook.current.setPageNum(2); hook.current.setPageSize(20); }); await flush(); expect(hook.current.pageNum).toBe(2);
  act(() => hook.current.setSearchParams({ keyword: "abc" })); await flush(); expect(fetcher.mock.lastCall?.[0]).toMatchObject({ pageNum: 1, searchParams: { keyword: "abc" } });
  act(() => hook.current.setPageSize(50)); await flush(); expect(hook.current.pageNum).toBe(1); expect(hook.current.pageSize).toBe(50);
});
it("受控 URL 查询与服务返回的页码校正保留过滤条件和附加数据", async () => {
  const hook = renderHook(() => {
    const [query, setQuery] = useState({ pageNum: 999, pageSize: 20, searchParams: { keyword: "标题" } });
    return useBasePageTable({ query, onQueryChange: setQuery, debounceTime: 0, getTableData: async () => ({ data: [{ id: "a" }], total: 1, pageNum: 1, meta: { generation: "g" } }) });
  });
  await flush(); await flush(); expect(hook.current.pageNum).toBe(1); expect(hook.current.searchParams.keyword).toBe("标题"); expect(hook.current.data?.meta.generation).toBe("g");
});
it("选中状态来自行数据，单选、批量选择和刷新保持一致", () => {
  const hook = renderHook(() => {
    const [rows, setRows] = useState([{ id: "a", _checked: false }, { id: "b", _checked: false }]);
    return { rows, setRows, ...useTableChecked({ tableData: rows, setTableData: setRows, idName: "id" }) };
  });
  act(() => hook.current.toggleChecked("a"));
  expect(hook.current.rows[0]._checked).toBe(true);
  expect(hook.current.checkedIds).toEqual(["a"]);
  expect(hook.current.isIndeterminate).toBe(true);
  act(() => hook.current.changeChecked(["b"], true));
  expect(hook.current.isAllChecked).toBe(true);
  act(() => hook.current.handleSelectAll());
  expect(hook.current.checkedCount).toBe(0);
  act(() => { hook.current.toggleChecked("a"); hook.current.toggleChecked("a"); });
  expect(hook.current.checkedIds).toEqual([]);
  act(() => hook.current.changeChecked(["b"], true));
  act(() => hook.current.setRows([{ id: "c", _checked: false }]));
  expect(hook.current.checkedItems).toEqual([]);
});
it("按 ID 更新匹配实际行而不是请求 ID 的数组位置", async () => {
  const hook = renderHook(() => {
    const [rows,setRows] = useState([{ id:"a", value:1 },{ id:"b", value:2 }]);
    const reload = useReloadDataById({ idName:"id", setTableData:setRows, getTableDataById:async () => [{ id:"b", value:3 }] });
    return { rows,reload };
  });
  await act(async () => hook.current.reload(["b"])); expect(hook.current.rows).toEqual([{ id:"a",value:1 },{ id:"b",value:3 }]);
});
it("默认测量选项不会在每次渲染重新创建观察器", async () => {
  const observe = vi.fn(); const disconnect = vi.fn(); const create = vi.fn();
  vi.stubGlobal("ResizeObserver", class { constructor() { create(); } observe = observe; disconnect = disconnect; });
  const element = document.createElement("div");
  const hook = renderHook(() => { const ref = useRef(element); return useElementBottomDistance(ref); });
  const count = create.mock.calls.length;
  hook.rerender(); await act(async () => { await vi.advanceTimersByTimeAsync(40); }); hook.rerender();
  expect(create).toHaveBeenCalledTimes(count);
});
