import "@/utils/ignoreError";
import ReactDOM from "react-dom/client";
import "./global.less";
import { getENV } from "./utils";
import { Spin } from "antd";
import "moment/locale/zh-cn"; // 引入moment的中文语言包
import moment from "moment";
import { NAV_NAME } from "./layout/layoutConfig";
import { befroeCreated } from "./router/routerGuard";
import App from "./App";
moment.locale("zh-cn"); // 设置moment区域为中文
console.log("#当前环境：", getENV());
const renderHtml = async () => {
  const navName = NAV_NAME;
  const RootDom = ReactDOM.createRoot(
    document.getElementById("root") as HTMLElement
  );
  RootDom.render(
    <>
      <div className="app-loading">
        <Spin size="large" />
        <div className="app-loading-title">{navName}</div>
      </div>
    </>
  );
  await befroeCreated();
  RootDom.render(<App />);
};
renderHtml();
