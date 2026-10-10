import style from "./index.module.less";
import Nav from "./components/Nav";
import Side from "./components/Side";
import { Outlet } from "react-router-dom";
import { layoutStore } from "@/store/sys";
import { layoutConfig } from "./layoutConfig";
import { useEffect } from "react";
import PublicBreadcrumb from "@/components/PublicBreadcrumb";

export default function Layout() {
  const { sideNavHide, topNavHide } = layoutStore;
  const {
    NAV_NAME,
    sideNavWidth,
    navHeight,
    collapsed,
    boxMinWidth,
    bodyPadding,
  } = layoutConfig;
  document.title = NAV_NAME;

  useEffect(() => {
    const collapsedEvent = () => {
      if (document.documentElement.offsetWidth < 1100) {
        layoutConfig.collapsed = true;
      } else {
        layoutConfig.collapsed = false;
      }
    };
    collapsedEvent();
    window.addEventListener("resize", collapsedEvent);
    return () => {
      window.removeEventListener("resize", collapsedEvent);
    };
  }, []);
  const isFreePage = sideNavHide && topNavHide;
  const gridTemplateRows = topNavHide ? "1fr" : `${navHeight}px 1fr`;
  const gridTemplateColumns = sideNavHide
    ? "1fr"
    : `${collapsed ? 60 : sideNavWidth}px 1fr`;
  const gridTemplateAreas =
    topNavHide && sideNavHide
      ? `"main"`
      : topNavHide
      ? `"side main"`
      : sideNavHide
      ? `"nav" "main"`
      : `"nav nav" "side main"`;

  return (
    <div
      className={style.wrapper}
      style={{
        minWidth: boxMinWidth,
        gridTemplateRows,
        gridTemplateColumns,
        gridTemplateAreas,
      }}
    >
      {!sideNavHide && <Side />}
      {!topNavHide && <Nav />}

      <main
        className={style.bodyMain}
        style={{
          padding: isFreePage
            ? 0
            : `${bodyPadding.top}px ${bodyPadding.left}px`,
        }}
      >
        {!topNavHide && <PublicBreadcrumb />}
        <div className={style.pageContent}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
