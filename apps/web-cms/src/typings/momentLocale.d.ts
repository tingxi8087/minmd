/**
 * moment 的语言包以副作用方式引入（如 `import "moment/locale/zh-cn"`），
 * 而 moment 包内只提供了 `locale/*.js`，没有对应的 `.d.ts` 声明文件，
 * 因此这里补充通配声明，避免 TS 报 “Cannot find module or type declarations
 * for side-effect import of 'moment/locale/zh-cn'”（TS2882）。
 */
declare module "moment/locale/*";
