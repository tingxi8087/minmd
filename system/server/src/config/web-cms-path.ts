/** 前后端共用的后台部署路径，不包含域名、查询参数或 Hash 路由。 */
export function webCmsPath(value = "/web-cms") {
  const path = value === "/" ? value : value.replace(/\/$/, "");
  if (
    (path !== "/" && !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path)) ||
    /^\/api(?:\/|$)/.test(path)
  ) {
    throw new Error(
      "Invalid configuration: WEB_CMS_PATH must be a local path outside /api",
    );
  }
  return path;
}
