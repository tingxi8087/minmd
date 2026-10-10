import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import styles from "./index.module.less";
export type ContextItem = {
  key: string;
  label?: ReactNode;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  type?: "divider";
  run?: () => void;
};
type MenuState = {
  x: number;
  y: number;
  items: ContextItem[];
  label: string;
  preserveFocus: boolean;
};
export function useContextMenu() {
  const [state, setState] = useState<MenuState | null>(null);
  const open = (
    event: {
      preventDefault(): void;
      stopPropagation(): void;
      clientX: number;
      clientY: number;
    },
    items: ContextItem[],
    label: string,
    preserveFocus = false,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setState({
      x: event.clientX,
      y: event.clientY,
      items,
      label,
      preserveFocus,
    });
  };
  const openButton = (
    event: React.MouseEvent<HTMLElement>,
    items: ContextItem[],
    label: string,
    preserveFocus = false,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    open(
      {
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopPropagation(),
        clientX: rect.right,
        clientY: rect.bottom + 4,
      },
      items,
      label,
      preserveFocus,
    );
  };
  return {
    open,
    openButton,
    close: () => setState(null),
    menu: state && <ContextMenu state={state} close={() => setState(null)} />,
  };
}
function ContextMenu({
  state,
  close,
}: {
  state: MenuState;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [point, setPoint] = useState({ x: state.x, y: state.y });
  useLayoutEffect(() => {
    const rect = ref.current!.getBoundingClientRect();
    setPoint({
      x: Math.max(8, Math.min(state.x, innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(state.y, innerHeight - rect.height - 8)),
    });
    setActiveKey(null);
    if (!state.preserveFocus)
      ref
        .current!.querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus({ preventScroll: true });
  }, [state]);
  useEffect(() => {
    const outside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const hide = () => close();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [state]);
  useEffect(() => {
    if (!state.preserveFocus) return;
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
        }
        close();
        return;
      }
      const items = state.items.filter(
        (item) => item.type !== "divider" && !item.disabled,
      );
      if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        const i = items.findIndex((item) => item.key === activeKey);
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? items.length - 1
              : i < 0
                ? e.key === "ArrowUp"
                  ? items.length - 1
                  : 0
                : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                  items.length;
        setActiveKey(items[next]?.key || null);
      } else if (e.key === "Enter" && activeKey) {
        e.preventDefault();
        e.stopPropagation();
        close();
        items.find((item) => item.key === activeKey)?.run?.();
      } else if (
        e.key.length === 1 ||
        e.key === "Backspace" ||
        e.key === "Delete"
      )
        close();
    };
    document.addEventListener("keydown", keyboard, true);
    return () => document.removeEventListener("keydown", keyboard, true);
  }, [state, activeKey]);
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={state.label}
      className={styles.menu}
      style={{ left: point.x, top: point.y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === "Tab") {
          close();
          return;
        }
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        const buttons = Array.from(
          ref.current!.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        );
        if (!buttons.length) return;
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                buttons.length
        ].focus({ preventScroll: true });
      }}
    >
      {state.items.map((item) =>
        item.type === "divider" ? (
          <div key={item.key} role="separator" className={styles.divider} />
        ) : (
          <button
            key={item.key}
            role="menuitem"
            data-active={activeKey === item.key || undefined}
            disabled={item.disabled}
            className={item.danger ? styles.danger : ""}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              close();
              item.run?.();
            }}
          >
            {item.icon && <span className={styles.icon}>{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
