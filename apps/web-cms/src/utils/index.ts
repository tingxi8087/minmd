/** 获取环境变量 */
export function isBeta() {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  //@ts-ignore
  return import.meta.env.VITE_ENV == "dev";
}
/** 获取环境变量 */
export function getENV() {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  //@ts-ignore
  return import.meta.env.VITE_ENV;
}
/** 延时 */
export function sleep(time: number) {
  return new Promise((resolve) => setTimeout(resolve, time));
}