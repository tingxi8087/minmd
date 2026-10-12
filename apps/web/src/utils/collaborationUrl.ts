/** 正式协作与 HTTP 接口共用网页来源，开发反代时也不使用编译时端口。 */
export function collaborationUrl(
  path: string,
  origin = window.location.origin,
) {
  return new URL(path, origin.replace(/^http/, "ws")).toString();
}
