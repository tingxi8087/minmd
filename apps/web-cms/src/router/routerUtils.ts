import { layoutStore } from "@/store/sys";
import { Location } from "react-router-dom";

export const hideSideNav = (pathList: string[] = [], location: Location<any>) => {
  layoutStore.sideNavHide = pathList.includes(location.pathname);
};
export const hideTopNav = (pathList: string[] = [], location: Location<any>) => {
  layoutStore.topNavHide = pathList.includes(location.pathname);
};