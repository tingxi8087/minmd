import { createRequire } from "node:module";
import { resolve } from "node:path";

// 同时从根目录和工作区入口加载；不连接数据库，检查镜像中的传递依赖能否独立解析。
for (const manifest of ["package.json", "system/server/package.json"]) {
  const require = createRequire(resolve(manifest));
  const pg = require("pg") as typeof import("pg");
  const { drizzle } =
    require("drizzle-orm/node-postgres") as typeof import("drizzle-orm/node-postgres");
  if (pg.types.getTypeParser(23)("42") !== 42) {
    throw new Error(`数据库类型解析器加载失败：${manifest}`);
  }
  const pool = new pg.Pool({ max: 1 });
  drizzle(pool);
  await pool.end();
}
console.log("容器数据库依赖加载检查通过");
