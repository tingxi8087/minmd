import type { Editor } from "@tiptap/react";
import { Dropdown } from "antd";
import { ChevronDown } from "lucide-react";
import TextColorPicker from "./TextColorPicker";
import TooltipButton from "@/components/TooltipButton";
import styles from "../index.module.less";

export default function TextFormatting({ editor }: { editor: Editor }) {
  const { fontSize } = editor.getAttributes("textStyle");
  return (
    <>
      <Dropdown
        trigger={["click"]}
        menu={{
          selectedKeys: [fontSize || "default"],
          items: [
            { key: "default", label: "默认字号" },
            ...[12, 14, 16, 18, 20, 24, 28, 32, 40, 48].map((size) => ({
              key: `${size}px`,
              label: `${size} px`,
            })),
          ],
          onClick: ({ key }) =>
            key === "default"
              ? editor.chain().focus().unsetFontSize().run()
              : editor.chain().focus().setFontSize(key).run(),
        }}
      >
        <TooltipButton
          className={styles.fontSizeSelect}
          aria-label="字号"
          onMouseDown={(e) => e.preventDefault()}
        >
          {fontSize ? fontSize.replace("px", "") : "字号"}
          <ChevronDown size={12} />
        </TooltipButton>
      </Dropdown>
      <TextColorPicker editor={editor} />
    </>
  );
}
