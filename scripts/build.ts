import { rm } from "node:fs/promises";
import { appConfig } from "../app.config";
const notices = Bun.spawn(["bun", "scripts/generate-third-party-notices.ts"], {
  stdout: "inherit",
  stderr: "inherit",
});
if ((await notices.exited) !== 0) process.exit(1);
const webBuild = Bun.spawn(["bun", "run", "--cwd", "apps/web", "build"], {
  stdout: "inherit",
  stderr: "inherit",
});
if ((await webBuild.exited) !== 0) process.exit(1);
const webCmsBuild = Bun.spawn(
  ["bun", "run", "--cwd", "apps/web-cms", "build"],
  { stdout: "inherit", stderr: "inherit" },
);
if ((await webCmsBuild.exited) !== 0) process.exit(1);
const result = await Bun.build({
  entrypoints: [appConfig.serverEntry],
  outdir: "dist/server",
  naming: "main.[ext]",
  target: "bun",
  minify: true,
  sourcemap: "external",
});
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
// 只转换公开模板，不复制本机 .env、密码或 public 中的文件。
const example = (await Bun.file(".env.example").text())
  .replace(/^APP_ENV=.*$/m, "APP_ENV=production")
  .replace(/^PUBLIC_ORIGIN=.*$/m, "PUBLIC_ORIGIN=https://docs.example.com")
  .replace(
    /^APP_PUBLIC_ORIGIN=.*$/m,
    "APP_PUBLIC_ORIGIN=https://docs.example.com",
  )
  .replace(/^# WEB_CMS_DIST=.*$/m, "WEB_CMS_DIST=web-cms")
  .replace(/^# WEB_DIST=.*$/m, "WEB_DIST=web")
  .replace(
    "相对于启动目录；默认 dist/web，仅预发和正式环境托管。",
    "相对于启动目录；部署包中使用 web。",
  )
  .replace(
    "相对于项目根目录；默认 dist/web-cms，通常无需修改。",
    "相对于启动目录；部署包中使用 web-cms。",
  )
  .replace(
    "相对于项目根目录，也支持绝对路径",
    "相对于启动目录，也支持绝对路径",
  );
await Bun.write("dist/.env.example", example);
// 各静态站点和离线部署包均携带同版本许可全文，避免打包后丢失版权声明。
for (const directory of ["dist", "dist/web", "dist/web-cms"]) {
  await Bun.write(
    `${directory}/THIRD_PARTY_NOTICES.txt`,
    Bun.file("THIRD_PARTY_NOTICES.txt"),
  );
  await Bun.write(`${directory}/LICENSE`, Bun.file("LICENSE"));
}
// 移除旧构建生成的依赖清单；保留部署配置、公开文件和运行数据。
await rm("dist/package.json", { force: true });
await rm("dist/bun.lock", { force: true });
console.log(
  "构建完成：dist/web 为前台，dist/web-cms 为后台，dist/server 为后端。后端进入 dist 配置 .env 后运行 bun server/main.js；同一后端端口托管前后台页面、API、协作连接与 MCP。",
);
