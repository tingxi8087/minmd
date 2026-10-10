import { DependencyList, useCallback, useEffect, useRef, useState } from "react";

export interface ResourceOptions {
  delay?: number;
  subscribe?: (reload: () => void) => () => void;
}

/** 通用异步读取：仅最新请求可更新数据、错误和 loading。 */
export function useResource<T>(fetcher: () => Promise<T>, deps: DependencyList, options: ResourceOptions = {}) {
  const { delay = 0, subscribe } = options;
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(r => r + 1), []);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  useEffect(() => subscribe?.(reload), [subscribe, reload]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    const timer = setTimeout(() => {
      Promise.resolve().then(() => fetchRef.current()).then(result => {
        if (active) setData(result);
      }).catch(problem => {
        if (active) { setError(problem); setData(undefined); }
      }).finally(() => { if (active) setLoading(false); });
    }, delay);
    return () => { active = false; clearTimeout(timer); };
  }, [...deps, revision, delay]);
  return { data, error, loading, reload, setData, setLoading };
}
