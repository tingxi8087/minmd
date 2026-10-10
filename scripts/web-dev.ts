import { startWeb } from "./web-process";
const child = startWeb();
process.on("SIGINT", () => child.kill("SIGTERM"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.exitCode = await child.exited;
