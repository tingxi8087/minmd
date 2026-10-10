import { accessStore } from "@/store/sys";
import React, { useEffect, useState } from "react";
import type { MenuProps } from "antd";
import { Button, ConfigProvider, Menu, Tooltip } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import { getMenuRouter, findMenuPath } from "@/.utils/routerRender";
import { RouterIndex } from "@/router";
import type { ItemType, MenuItemType } from "antd/es/menu/interface";
import { layoutConfig } from "../../layoutConfig";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import styles from "./index.module.less";
// 要自定义菜单改这个就好
const navList: ItemType<MenuItemType>[] | undefined = undefined;
const Side: React.FC = () => {
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const location = useLocation();
  const { list: accessList } = accessStore;
  const list = navList || getMenuRouter(RouterIndex);
  const navigate = useNavigate();
  const { collapsed } = layoutConfig;
  const onClick: MenuProps["onClick"] = (e) => {
    navigate(e.key);
    setSelected([e.key]);
  };
  const onOpenChange: MenuProps["onOpenChange"] = (e) => {
    setOpenKeys(e);
  };
  useEffect(() => {
    setSelected([location.pathname]);
    const ancestors = findMenuPath(navList || getMenuRouter(RouterIndex), location.pathname).slice(0, -1).map(item => String(item.key));
    setOpenKeys(previous => [...new Set([...previous, ...ancestors])]);
  }, [location, accessList]);

  return (
    <div className={styles.side}>
      <ConfigProvider theme={{ components: { Menu: { itemMarginInline: 8 } } }}>
      <Menu
        className={styles.sideMenu}
        onClick={onClick}
        onOpenChange={onOpenChange}
        style={{
          width: "100%",
          flex: 1,
          minHeight: 0,
          overflow: "auto",
        }}
        openKeys={openKeys}
        selectedKeys={selected}
        mode="inline"
        items={list}
        inlineCollapsed={collapsed}
      />
      </ConfigProvider>
      <div
        className={styles.sideFooter}
        style={{
          width: "100%",
          ...(collapsed ? { padding: 0, justifyContent: "center" } : {}),
        }}
      >
        <Tooltip title={collapsed ? "展开菜单" : "收起菜单"}>
          <Button
            type="text"
            className={styles.collapseButton}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => (layoutConfig.collapsed = !collapsed)}
          />
        </Tooltip>
      </div>
    </div>
  );
};

export default Side;
