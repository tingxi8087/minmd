import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { isDemo } from "./runtime";
import "./global.less";
async function start() {
  if (isDemo) await (await import("@/demo/bootstrap")).installDemo();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
void start();
