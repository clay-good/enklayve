import { defineConfig, type Plugin } from "vitest/config";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderToolsIndex } from "./scripts/tools-index";
import { renderServiceWorker, renderWebManifest } from "./scripts/service-worker";

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

/**
 * Emit the offline service worker and the web app manifest (BUILD-SPEC.md §8,
 * §11). The worker precaches a small core shell (index.html, the entry JS/CSS,
 * the static pages, the manifest, and the icons) and runtime-caches everything
 * else on use. Its cache version is a hash of the full built asset list plus the
 * data manifest, so any code or data refresh invalidates the cache.
 */
function offlinePwa(): Plugin {
  return {
    name: "enklayve-offline-pwa",
    apply: "build",
    generateBundle(_options, bundle) {
      const fileNames = Object.keys(bundle);
      // Core shell: the entry chunks and top-level CSS, plus the static pages,
      // manifest, and icons. Lazy chunks (pdf.js, etc.) are runtime-cached.
      const core = new Set<string>([
        "/",
        "/index.html",
        "/tools.html",
        "/manifest.webmanifest",
        "/favicon.svg",
        "/icon.svg",
      ]);
      for (const [name, output] of Object.entries(bundle)) {
        if (output.type === "chunk" && output.isEntry) core.add(`/${name}`);
        if (output.type === "asset" && name.endsWith(".css")) core.add(`/${name}`);
      }

      let dataManifest = "";
      try {
        dataManifest = readFileSync(resolve(REPO_ROOT, "data", "manifest.json"), "utf8");
      } catch {
        dataManifest = "";
      }
      const version = createHash("sha256")
        .update([...fileNames].sort().join(",") + dataManifest)
        .digest("hex")
        .slice(0, 12);

      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: renderServiceWorker([...core], version),
      });
      this.emitFile({
        type: "asset",
        fileName: "manifest.webmanifest",
        source: renderWebManifest(),
      });
    },
  };
}

export default defineConfig({
  root: REPO_ROOT,
  publicDir: resolve(REPO_ROOT, "public"),
  plugins: [staticToolsIndex(), offlinePwa()],
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
