/** 只由独立的 demo 构建开启，正式构建固定为 false。 */
export const isDemo = import.meta.env.MINMD_DEMO === true;
