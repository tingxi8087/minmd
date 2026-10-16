import {
  cloneElement,
  isValidElement,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Tooltip } from "antd";

import { isDemo } from "./runtimeMode";
export { isDemo } from "./runtimeMode";
export const demoHint = "部署后可使用";
export function demoMenu<
  const T extends { key?: React.Key; label?: ReactNode },
>(items: T[]): T[] {
  return isDemo
    ? items.map((item) =>
        [
          "share",
          "history",
          "save",
          "notifications",
          "shared-with-me",
          "logout",
          "create-space",
        ].includes(String(item.key))
          ? {
              ...item,
              disabled: true,
              title: demoHint,
              label: (
                <>
                  {item.label}
                  <small className="demo-menu-hint">{demoHint}</small>
                </>
              ),
            }
          : item,
      )
    : items;
}

export function FullVersion({
  children,
  feature,
}: {
  children: ReactNode;
  feature?: string;
}) {
  if (!isDemo) return children;
  if (
    !feature ||
    !isValidElement<HTMLAttributes<HTMLElement> & { tooltip?: ReactNode }>(
      children,
    )
  )
    return null;
  const hint = `${feature} · ${demoHint}`;
  const control = cloneElement(children, {
    "aria-disabled": true,
    "aria-label": hint,
    className: `${children.props.className ?? ""} demo-disabled`,
    ...(typeof children.type === "string" ? {} : { tooltip: hint }),
    onClick: (event) => {
      event.preventDefault();
      event.stopPropagation();
    },
    onMouseDown: (event) => {
      event.preventDefault();
      event.stopPropagation();
    },
    onKeyDown: (event) => {
      if (["Enter", " "].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  });
  return typeof children.type === "string" ? (
    <Tooltip title={hint} trigger={["hover", "focus"]}>
      {control}
    </Tooltip>
  ) : (
    control
  );
}
