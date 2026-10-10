type MasRouter = {
  /** 是否在菜单中显示 */
  hideMenu?: boolean;
  /** 菜单显示名称 */
  label?: string;
  /** 图标 */
  icon?: JSX.Element;
  /** 路径 */
  path: string;
  /** reactnode */
  element?: React.ReactNode;
  /** reactnode */
  errorElement?: React.ReactNode;
  /** 子路由 */
  children?: MasRouter;
  /** 菜单中是否显示禁用 */
  disabled?: boolean;
  access?: string;
}[];
