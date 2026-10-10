import { accessStore } from "@/store/sys";
import React, { useEffect, useState } from "react";
import { Breadcrumb } from "antd";
import { getMenuRouter, findMenuPath } from "@/.utils/routerRender";
import { RouterIndex } from "@/router";
import { useLocation, useNavigate } from "react-router-dom";
import styles from "./index.module.less";
const PublicBreadcrumb: React.FC = () => {
  const [breadcrumbList, setBreadcrumbList] = useState<any[]>([]);
  const location = useLocation();
  const { list } = accessStore;
  const navigate = useNavigate();
  useEffect(() => {
    const path = findMenuPath(getMenuRouter(RouterIndex, true), location.pathname);
    setBreadcrumbList(path.map((item, index) => ({
      key: item.key,
      title: <a onClick={event => { event.preventDefault(); navigate(String(item.key)); }}
        className={index === path.length - 1 ? styles.current : undefined}>{item.label}</a>,
    })));
  }, [location, list]);
  if (breadcrumbList.length == 0) {
    return <></>;
  }
  return (
    <div className={styles.wrapper}>
      <Breadcrumb className={styles.breadcrumb} items={breadcrumbList} />
    </div>
  );
};

export default PublicBreadcrumb;
