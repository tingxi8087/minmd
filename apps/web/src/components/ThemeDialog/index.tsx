import { Modal } from "antd";
import { Check, Moon, Sun } from "lucide-react";
import { useLayout } from "@/store/layout";
import { useWorkspace } from "@/store/workspace";
import styles from "./index.module.less";
export default function ThemeDialog() {
  const { themeDialogOpen, setThemeDialogOpen } = useLayout();
  const { theme, setTheme } = useWorkspace();
  const close = () => setThemeDialogOpen(false);
  return (
    <Modal
      title="主题设置"
      open={themeDialogOpen}
      onCancel={close}
      onOk={close}
      width={480}
      centered
      okText="完成"
      cancelButtonProps={{ style: { display: "none" } }}
    >
      <div className={styles.themes}>
        {(["light", "dark"] as const).map((value) => (
          <button
            key={value}
            className={`${styles.themeCard} ${theme === value ? styles.themeSelected : ""}`}
            aria-pressed={theme === value}
            onClick={() => setTheme(value)}
          >
            <div
              className={styles.themePreview}
              data-theme={value}
              aria-hidden="true"
            >
              <aside />
              <div>
                <i />
                <span />
                <span />
                <span />
              </div>
            </div>
            <span>
              {value === "light" ? <Sun size={15} /> : <Moon size={15} />}
              {value === "light" ? "晴日 · 浅色" : "夜读 · 深色"}
              {theme === value && <Check size={15} />}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
