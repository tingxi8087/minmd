import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { readDevPort } from "../../config/dev";
export default defineConfig(({ mode }) => {
  const env = loadEnv(
    mode,
    fileURLToPath(new URL("../../", import.meta.url)),
    "",
  );
  return {
    plugins: [react()],
    define: {
      "import.meta.env.MINMD_SHEET_VERIFY_WS": JSON.stringify(
        (
          process.env.API_PROXY_TARGET ||
          env.API_PROXY_TARGET ||
          "http://127.0.0.1:9811"
        ).replace(/^http/, "ws"),
      ),
    },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    build: { outDir: "../../dist/web", emptyOutDir: true },
    server: {
      host: "127.0.0.1",
      port: readDevPort(process.env.WEB_PORT ?? env.WEB_PORT, 5173),
      strictPort: true,
      proxy: {
        "/mcp": {
          target:
            process.env.API_PROXY_TARGET ||
            env.API_PROXY_TARGET ||
            "http://127.0.0.1:9811",
          changeOrigin: false,
        },
        "/api": {
          target:
            process.env.API_PROXY_TARGET ||
            env.API_PROXY_TARGET ||
            "http://127.0.0.1:9811",
          changeOrigin: false,
          ws: true,
        },
      },
    },
  };
});
