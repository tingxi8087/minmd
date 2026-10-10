import eBox from "e-boxes";

export const layoutStore = eBox({
  sideNavHide: false,
  topNavHide: false,
});
export const accessStore = eBox<any>({ list: [] });
