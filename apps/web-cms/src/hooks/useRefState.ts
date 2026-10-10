import { Dispatch, SetStateAction, useCallback, useRef, useState } from "react";

export type ReadonlyStateRef<T> = { readonly current: T };

/** 状态更新同时写入 ref，供事件与异步回调读取最新值。 */
export const useRefState = <T>(initialState: T | (() => T)):
  [T, Dispatch<SetStateAction<T>>, ReadonlyStateRef<T>] => {
  const [state, setState] = useState(initialState);
  const stateRef = useRef(state);
  const setRefState: Dispatch<SetStateAction<T>> = useCallback((value) => {
    const next = typeof value === "function"
      ? (value as (previous: T) => T)(stateRef.current)
      : value;
    stateRef.current = next;
    setState(next);
  }, []);
  return [state, setRefState, stateRef];
};
