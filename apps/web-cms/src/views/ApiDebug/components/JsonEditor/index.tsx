import { forwardRef, useImperativeHandle, useEffect, useRef } from "react";
import { JSONEditor, Mode } from "vanilla-jsoneditor";
import styles from "./index.module.less";

/** One editor instance per panel; externally replaced values do not reset edits on each keystroke. */
export interface JsonEditorRef {
  read(): string;
}
const JsonEditorComponent = forwardRef<
  JsonEditorRef,
  {
    value: string;
    onChange?: (value: string) => void;
    readOnly?: boolean;
    label?: string;
  }
>(function JsonEditor(
  { value, onChange, readOnly = false, label = "JSON 编辑器" },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<JSONEditor>();
  const latest = useRef(onChange);
  const emitted = useRef(value);
  latest.current = onChange;
  useImperativeHandle(
    ref,
    () => ({
      read() {
        // validate flushes the text editor's pending debounced change before get.
        editor.current?.validate();
        const content = editor.current?.get();
        return content
          ? "text" in content
            ? content.text
            : JSON.stringify(content.json, null, 2)
          : emitted.current;
      },
    }),
    [],
  );
  useEffect(() => {
    if (!container.current) return;
    const instance = new JSONEditor({
      target: container.current,
      props: {
        content: { text: value },
        readOnly,
        mode: readOnly ? Mode.tree : Mode.text,
        mainMenuBar: true,
        navigationBar: true,
        statusBar: true,
        onChange(content) {
          const next =
            "text" in content
              ? content.text
              : JSON.stringify(content.json, null, 2);
          emitted.current = next;
          latest.current?.(next);
        },
      },
    });
    editor.current = instance;
    return () => {
      void instance.destroy();
      editor.current = undefined;
    };
    // Initial props create the editor; updates below preserve its selection and mode.
  }, []);
  useEffect(() => {
    editor.current?.updateProps({ readOnly });
    if (value !== emitted.current) {
      emitted.current = value;
      editor.current?.updateProps({ content: { text: value } });
    }
  }, [value, readOnly]);
  return (
    <div
      ref={container}
      className={styles.editor}
      role="region"
      aria-label={label}
    />
  );
});

export default JsonEditorComponent;
