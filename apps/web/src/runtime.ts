/** 只由独立的 demo 构建开启，正式构建固定为 false。 */
export const isDemo = import.meta.env.MINMD_DEMO === true;
export function demoMenu<const T extends { key?: React.Key }>(items: T[]): T[] {
  return isDemo
    ? items.filter(
        (item) =>
          ![
            "share",
            "history",
            "save",
            "notifications",
            "shared-with-me",
            "logout",
          ].includes(String(item.key)),
      )
    : items;
}

export function FullVersion({ children }: { children: React.ReactNode }) {
  return isDemo ? null : children;
}
