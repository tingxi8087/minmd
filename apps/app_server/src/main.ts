import { startApp } from "@mas/system-server";
import { buildApp } from "./app";

await startApp(buildApp);
