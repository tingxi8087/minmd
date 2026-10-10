import "braft-editor/dist/index.css";
import { CSSProperties } from "react";
import ReactQuill from "react-quill";
const quillOptions = {
  toolbar: {
    container: [
      ["bold", "italic", "underline", "strike"],
      ["blockquote", "code-block"],
      [{ header: 1 }, { header: 2 }],
      [{ list: "ordered" }, { list: "bullet" }],
      [{ script: "sub" }, { script: "super" }],
      [{ indent: "-1" }, { indent: "+1" }],
      [{ direction: "rtl" }],
      [{ size: ["small", false, "large", "huge"] }], //字体设置
      [
        {
          color: [],
        },
      ],
      [
        {
          background: [],
        },
      ],
      [{ font: [] }],
      [{ align: [] }],
      ["link", "image"], // a链接和图片的显示
    ],
  },
};
const EditorPro = (props: {
  value?: string;
  onChange?: any;
  placeholder?: string;
  style?: CSSProperties;
  className?: string;
}) => {
  const { value, onChange, placeholder, style, className } = props;
  return (
    <ReactQuill
      value={value}
      className={className}
      onChange={(value: string) => {
        if (onChange) {
          onChange(value);
        }
      }}
      style={style}
      placeholder={placeholder}
      theme="snow"
      modules={quillOptions}
    />
  );
};

export default EditorPro;
