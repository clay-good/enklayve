import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname);

export default defineConfig({
  root: REPO_ROOT,
  publicDir: resolve(REPO_ROOT, "public"),
  build: {
    outDir: resolve(REPO_ROOT, "dist"),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
  },
  resolve: {
    alias: {
      "@": resolve(REPO_ROOT, "src"),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    globals: false,
  },
});
