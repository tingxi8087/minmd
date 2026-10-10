import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  esbuild: {jsx: "automatic"},
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "e-boxes": path.resolve(__dirname, "node_modules/e-boxes/dist/index.es.js") } },
  test: { environment: "jsdom", include: ["tests/**/*.test.{ts,tsx}"], restoreMocks: true },
});
