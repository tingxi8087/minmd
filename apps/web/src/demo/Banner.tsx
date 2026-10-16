import { FlaskConical, Github, RotateCcw } from "lucide-react";
import { App } from "antd";
import "./demo.less";
export default function DemoBanner() {
  const { modal } = App.useApp();
  return (
    <div className="demo-banner" role="note">
      <span className="demo-badge">
        <FlaskConical size={14} />
        演示模式
      </span>
      <span className="demo-hint">随手试写，刷新即重置</span>
      <div className="demo-actions">
        <button
          onClick={() =>
            modal.confirm({
              title: "重置演示？",
              content: "当前页面的修改和导入文件将被清除，恢复初始示例。",
              okText: "重置演示",
              cancelText: "继续体验",
              onOk: () => {
                location.hash = "#/files";
                location.reload();
              },
            })
          }
        >
          <RotateCcw size={13} />
          <span>重置演示</span>
        </button>
        <a
          href="https://github.com/tingxi8087/minmd"
          target="_blank"
          rel="noreferrer"
        >
          <Github size={14} />
          <span>源码与部署</span>
        </a>
      </div>
    </div>
  );
}
