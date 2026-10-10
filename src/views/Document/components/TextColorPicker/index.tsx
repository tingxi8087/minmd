import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { ColorPicker, Popover } from "antd";
import { Baseline, ChevronDown, Palette } from "lucide-react";
import TooltipButton from "@/components/TooltipButton";
import styles from "./index.module.less";
import documentStyles from "../../index.module.less";
const hues = ["gray", "red", "orange", "yellow", "green", "blue", "purple"];
const names: Record<string, string> = {
  gray: "灰色",
  red: "红色",
  orange: "橙色",
  yellow: "黄色",
  green: "绿色",
  blue: "蓝色",
  purple: "紫色",
};
type Kind = "text" | "background";
const readRecent = (kind: Kind): string[] => {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(`minmd-custom-${kind}-colors`) || "[]",
    );
    return Array.isArray(value)
      ? value
          .filter(
            (color): color is string =>
              typeof color === "string" && /^#[\da-f]{6}$/i.test(color),
          )
          .slice(0, 8)
      : [];
  } catch {
    return [];
  }
};
const resolve = (token: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(token).trim();
const sameColor = (a?: string, b?: string) =>
  a?.replace(/\s/g, "").toLowerCase() === b?.replace(/\s/g, "").toLowerCase();
export default function TextColorPicker({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<Record<Kind, string[]>>({
    text: readRecent("text"),
    background: readRecent("background"),
  });
  const { color, backgroundColor } = editor.getAttributes("textStyle");
  const apply = (kind: Kind, value?: string) => {
    const chain = editor.chain().focus();
    if (kind === "text")
      value ? chain.setColor(value).run() : chain.unsetColor().run();
    else
      value
        ? chain.setBackgroundColor(value).run()
        : chain.unsetBackgroundColor().run();
  };
  const custom = (kind: Kind, value: string) => {
    apply(kind, value);
    const next = [value, ...readRecent(kind).filter((c) => c !== value)].slice(
      0,
      8,
    );
    setRecent((previous) => ({ ...previous, [kind]: next }));
    try {
      localStorage.setItem(`minmd-custom-${kind}-colors`, JSON.stringify(next));
    } catch {
      /* Formatting remains usable without storage. */
    }
  };
  const section = (kind: Kind) => {
    const text = kind === "text";
    const current = text ? color : backgroundColor;
    const label = text ? "字体颜色" : "背景颜色";
    const swatch = (token: string, name: string, defaultValue = false) => {
      const value = defaultValue ? undefined : resolve(token);
      const selected = defaultValue ? !current : sameColor(current, value);
      return (
        <TooltipButton
          key={token}
          aria-label={`${label}：${name}`}
          aria-pressed={selected}
          className={`${styles.swatch} ${selected ? styles.selected : ""} ${defaultValue && !text ? styles.noBackground : ""}`}
          style={
            text ? { color: `var(${token})` } : { background: `var(${token})` }
          }
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply(kind, value)}
        >
          {text && "A"}
        </TooltipButton>
      );
    };
    return (
      <section className={styles.section} aria-label={label}>
        <div className={styles.heading}>
          <span>{label}</span>
          <ColorPicker
            value={current || null}
            disabledAlpha
            format="hex"
            onChangeComplete={(value) => custom(kind, value.toHexString())}
          >
            <TooltipButton
              aria-label={`自定义${label}`}
              className={styles.customButton}
              onMouseDown={(e) => e.preventDefault()}
            >
              <Palette size={13} />
              自定义
            </TooltipButton>
          </ColorPicker>
        </div>
        <div className={styles.grid}>
          {swatch(text ? "--text" : "--surface", text ? "默认" : "无", true)}
          {hues.map((hue) =>
            swatch(`--palette-${text ? "text" : "soft"}-${hue}`, names[hue]),
          )}
          {!text &&
            ["neutral", ...hues].map((hue) =>
              swatch(`--palette-solid-${hue}`, `${names[hue] || "浅灰"}（深）`),
            )}
        </div>
        {recent[kind].length > 0 && (
          <div
            className={`${styles.grid} ${styles.recent}`}
            aria-label={`最近自定义${label}`}
          >
            {recent[kind].map((value) => (
              <TooltipButton
                key={value}
                aria-label={`${label} ${value}`}
                aria-pressed={sameColor(current, value)}
                className={`${styles.swatch} ${sameColor(current, value) ? styles.selected : ""}`}
                style={text ? { color: value } : { background: value }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply(kind, value)}
              >
                {text && "A"}
              </TooltipButton>
            ))}
          </div>
        )}
      </section>
    );
  };
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value)
          setRecent({
            text: readRecent("text"),
            background: readRecent("background"),
          });
      }}
      trigger="click"
      placement="bottomLeft"
      arrow={false}
      styles={{ body: { padding: 10 } }}
      content={
        <div className={styles.panel}>
          {section("text")}
          {section("background")}
          <button
            className={styles.reset}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              editor.chain().focus().unsetColor().unsetBackgroundColor().run()
            }
          >
            恢复默认
          </button>
        </div>
      }
    >
      <TooltipButton
        aria-label="文字颜色"
        aria-expanded={open}
        className={`${documentStyles.textColor} ${styles.trigger}`}
        onMouseDown={(e) => e.preventDefault()}
        style={{ backgroundColor: backgroundColor || undefined }}
      >
        <Baseline size={16} />
        <span style={{ background: color || "var(--text)" }} />
        <ChevronDown size={11} />
      </TooltipButton>
    </Popover>
  );
}
