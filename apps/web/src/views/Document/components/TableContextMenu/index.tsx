import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection, cellAround, selectedRect } from "@tiptap/pm/tables";
import {
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  Rows3,
  Columns3,
} from "lucide-react";
import { tableDeletePreview } from "../../extensions/tableDeletePreview";
import styles from "./index.module.less";
type MenuState = { x: number; y: number; rows: number; columns: number };
export default function TableContextMenu({ editor }: { editor: Editor }) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const preview = (value: "row" | "column" | null) =>
    editor.view.dispatch(editor.state.tr.setMeta(tableDeletePreview, value));
  const close = () => {
    setMenu(null);
    preview(null);
  };
  useEffect(() => {
    let dom: HTMLElement | null = null;
    const cellAt = (event: MouseEvent) => {
      const target =
        event.target instanceof Element ? event.target.closest("td,th") : null;
      return target && dom?.contains(target) ? target : null;
    };
    const down = (event: MouseEvent) => {
      if (event.button === 2 && cellAt(event)) event.preventDefault();
    };
    const context = (event: MouseEvent) => {
      const cell = cellAt(event);
      if (!cell || !editor.isEditable) return;
      const $cell = cellAround(
        editor.state.doc.resolve(editor.view.posAtDOM(cell, 0)),
      );
      if (!$cell) return;
      event.preventDefault();
      const selection = editor.state.selection;
      let inside = false;
      if (selection instanceof CellSelection)
        selection.forEachCell((_node, pos) => {
          if (pos === $cell.pos) inside = true;
        });
      if (!inside)
        editor.view.dispatch(
          editor.state.tr.setSelection(
            TextSelection.near(editor.state.doc.resolve($cell.pos + 1)),
          ),
        );
      const rect = selectedRect(editor.state);
      preview(null);
      setMenu({
        x: event.clientX,
        y: event.clientY,
        rows: rect.bottom - rect.top,
        columns: rect.right - rect.left,
      });
    };
    const hide = () => setMenu(null);
    const bind = () => {
      dom = editor.view.dom;
      dom.addEventListener("mousedown", down);
      dom.addEventListener("contextmenu", context);
    };
    if (editor.isInitialized) bind();
    else editor.on("create", bind);
    editor.on("update", hide);
    editor.on("selectionUpdate", hide);
    return () => {
      editor.off("create", bind);
      dom?.removeEventListener("mousedown", down);
      dom?.removeEventListener("contextmenu", context);
      editor.off("update", hide);
      editor.off("selectionUpdate", hide);
    };
  }, [editor]);
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const x = Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8));
    const y = Math.max(
      8,
      Math.min(menu.y, window.innerHeight - rect.height - 8),
    );
    if (x !== menu.x || y !== menu.y) setMenu({ ...menu, x, y });
    menuRef.current
      .querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
  }, [menu?.x, menu?.y]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close();
    };
    const hide = () => close();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        editor.view.focus();
      }
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      document.removeEventListener("keydown", keyboard);
      if (!editor.isDestroyed) preview(null);
    };
  }, [Boolean(menu), editor]);
  if (!menu) return null;
  const items = [
    {
      label: "在上方插入行",
      Icon: ArrowUpToLine,
      run: () => editor.chain().focus().addRowBefore().run(),
    },
    {
      label: "在下方插入行",
      Icon: ArrowDownToLine,
      run: () => editor.chain().focus().addRowAfter().run(),
    },
    {
      label: "在左侧插入列",
      Icon: ArrowLeftToLine,
      run: () => editor.chain().focus().addColumnBefore().run(),
    },
    {
      label: "在右侧插入列",
      Icon: ArrowRightToLine,
      run: () => editor.chain().focus().addColumnAfter().run(),
    },
    {
      label: menu.rows > 1 ? `删除选中 ${menu.rows} 行` : "删除当前行",
      Icon: Rows3,
      mode: "row" as const,
      run: () => {
        const rect = selectedRect(editor.state);
        const chain = editor.chain().focus();
        return rect.top === 0 && rect.bottom === rect.map.height
          ? chain.deleteTable().run()
          : chain.deleteRow().run();
      },
    },
    {
      label: menu.columns > 1 ? `删除选中 ${menu.columns} 列` : "删除当前列",
      Icon: Columns3,
      mode: "column" as const,
      run: () => {
        const rect = selectedRect(editor.state);
        const chain = editor.chain().focus();
        return rect.left === 0 && rect.right === rect.map.width
          ? chain.deleteTable().run()
          : chain.deleteColumn().run();
      },
    },
  ];
  return createPortal(
    <div
      role="menu"
      aria-label="表格右键菜单"
      ref={menuRef}
      className={styles.menu}
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          const buttons = Array.from(
            menuRef.current!.querySelectorAll<HTMLButtonElement>("button"),
          );
          const i = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          buttons[
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? buttons.length - 1
                : (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                  buttons.length
          ].focus();
        }
        if (e.key === "Tab") close();
      }}
    >
      {items.map((item, i) => (
        <div key={item.label}>
          {i === 4 && <div role="separator" className={styles.divider} />}
          <button
            role="menuitem"
            className={item.mode ? styles.danger : ""}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => preview(item.mode || null)}
            onMouseLeave={() => preview(null)}
            onFocus={() => preview(item.mode || null)}
            onBlur={() => preview(null)}
            onClick={() => {
              close();
              item.run();
            }}
          >
            <item.Icon size={15} />
            <span>{item.label}</span>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
