import { RouteObject } from "react-router-dom";
import Layout from "@/layout/Layout";
import { aceessControll } from "./access";
import { ItemType, MenuItemType } from "antd/es/menu/interface";

export const getReactRouterChildren: (
  masRouter: MasRouter,
  accessArr: { [key in string]: string }
) => RouteObject[] = (masRouter: MasRouter, accessArr) => {
  return masRouter.map((route) => {
    const { children, path, element, errorElement, access } = route;
    if (access) {
      accessArr[path] = access;
    }
    let newChildren: any = children;
    if (children) {
      newChildren = getReactRouterChildren(children, accessArr);
    }
    return {
      // 无 element 的父项仅作菜单分组，不限制子页面原有绝对地址。
      path: children && !element ? undefined : path,
      element,
      errorElement,
      children: newChildren,
    };
  });
};

export const getReactRouter = (masRouter: MasRouter) => {
  const accessArr: { [key in string]: string } = {};
  const reactRouter = getReactRouterChildren(masRouter, accessArr);
  return { reactRouter, accessArr };
};
export const getMenuRouter: (
  masRouter: MasRouter,
  showHideMenu?: boolean
) => ItemType<MenuItemType>[] = (masRouter, showHideMenu = false) => {
  return masRouter
    .filter(
      (route) =>
        (showHideMenu || !route.hideMenu) &&
        aceessControll({ pathname: route.path } as any)
    )
    .map((route) => {
      const { children, path, icon, label, disabled } = route;
      let newChildren: any = children;
      if (children) {
        newChildren = getMenuRouter(children, showHideMenu);
      }
      const pathArr = path.split("/");
      return {
        key: path,
        icon,
        label: label || pathArr[pathArr.length - 1],
        children: newChildren,
        disabled,
      };
    });
};
export const useLayout: (router: MasRouter) => MasRouter = (router) => {
  return [
    {
      path: "/",
      element: <Layout />,
      children: router,
    },
  ];
};

/** 根据菜单树找出当前页面的完整祖先链，兼容分组与 URL 不同层级。 */
export function findMenuPath(items: any[], pathname: string): any[] {
  for (const item of items) {
    if (!item) continue;
    if (item.key === pathname) return [item];
    const children = item.children && findMenuPath(item.children, pathname);
    if (children?.length) return [item, ...children];
  }
  return [];
}
