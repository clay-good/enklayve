import { defineConfig, type Plugin } from "vitest/config";
import { resolve } from "node:path";
import { renderToolsIndex } from "./scripts/tools-index";

const REPO_ROOT = resolve(__dirname);

/**
 * Emit the static, crawlable All Tools index into the build output
 * (BUILD-SPEC-2 §1.2). The page is rendered in scripts/tools-index.ts so a
 * test can guard it against registry drift.
 */
function staticToolsIndex(): Plugin {
  return {
    name: "enklayve-static-tools-index",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "tools.html", source: renderToolsIndex() });
    },
  };
}

export default defineConfig({
  root: REPO_ROOT,
  publicDir: resolve(REPO_ROOT, "public"),
  plugins: [staticToolsIndex()],
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
