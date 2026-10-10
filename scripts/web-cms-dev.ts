import { startWebCms } from "./web-cms-process";
const child = startWebCms();
process.on("SIGINT", () => child.kill("SIGTERM"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.exitCode = await child.exited;
