import { useEffect, useRef, useState } from "react";
export function useDocumentTitle(name: string) {
  const [title, setTitle] = useState(name);
  const remoteName = useRef(name);
  useEffect(() => {
    const previous = remoteName.current;
    remoteName.current = name;
    // 仅同步尚未偏离服务端名称的标题，避免轮询或外部重命名覆盖本地输入。
    setTitle((current) => (current === previous ? name : current));
  }, [name]);
  return [title, setTitle] as const;
}
