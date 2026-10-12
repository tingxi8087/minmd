import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.tsx"],
    restoreMocks: true,
  },
});
