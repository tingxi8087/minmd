import eBox from "e-boxes";
export const NAV_NAME = "minmd";
export const NAV_LOGO = `${import.meta.env.BASE_URL}favicon.svg?v=minmd`;
// 导航左侧标题
export const layoutConfig = eBox({
  NAV_NAME,
  navHeight: 50,
  navPadding: 16,
  sideNavWidth: 200,
  boxMinWidth: 1200,
  collapsed: false,
  bodyPadding: {
    top: 4,
    left: 8,
  },
});
