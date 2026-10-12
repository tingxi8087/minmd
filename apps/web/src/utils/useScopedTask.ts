import { useEffect, useRef } from "react";
import { useAuth } from "@/store/auth";
import { useWorkspace } from "@/store/workspace";
export type ScopedTask = {
  signal: AbortSignal;
  assertActive: () => void;
  wait: <T>(operation: () => Promise<T>) => Promise<T>;
};
/** 页面任务在身份或空间变化时永久失效，防止下一次请求借用新账号 Cookie。 */
export function createScopedTask(
  readScope: () => { identity: unknown; spaceId: string },
) {
  const initial = readScope();
  const controller = new AbortController();
  const assertActive = () => {
    const current = readScope();
    if (
      current.identity !== initial.identity ||
      current.spaceId !== initial.spaceId
    )
      controller.abort();
    controller.signal.throwIfAborted();
  };
  return {
    controller,
    signal: controller.signal,
    assertActive,
    async wait<T>(operation: () => Promise<T>): Promise<T> {
      assertActive();
      const result = await operation();
      assertActive();
      return result;
    },
  };
}
export function useScopedTasks() {
  const tasks = useRef(new Set<ReturnType<typeof createScopedTask>>());
  useEffect(() => {
    const cancel = () => {
      for (const task of tasks.current) task.controller.abort();
      tasks.current.clear();
    };
    const offAuth = useAuth.subscribe((next, previous) => {
      if (next.user !== previous.user) cancel();
    });
    const offSpace = useWorkspace.subscribe((next, previous) => {
      if (next.space !== previous.space) cancel();
    });
    return () => {
      cancel();
      offAuth();
      offSpace();
    };
  }, []);
  return () => {
    const task = createScopedTask(() => ({
      identity: useAuth.getState().user,
      spaceId: useWorkspace.getState().space,
    }));
    tasks.current.add(task);
    return { ...task, finish: () => tasks.current.delete(task) };
  };
}
