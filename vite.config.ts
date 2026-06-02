import { defineConfig, type Plugin } from "vitest/config";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderToolsIndex } from "./scripts/tools-index";
import { toolPages } from "./scripts/tool-pages";
import { renderSitemap, renderRobots, SITE_ORIGIN } from "./scripts/sitemap";
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
 * Emit the crawlability surface (BUILD-SPEC.md §11, Phase 11): one pre-rendered
 * static shell per tile, plus a sitemap listing every indexable URL and a
 * robots.txt that advertises it. Each is rendered in scripts/ so a test guards
 * it against registry drift.
 */
function staticSeo(): Plugin {
  return {
    name: "enklayve-static-seo",
    apply: "build",
    generateBundle() {
      const pages = toolPages();
      for (const page of pages) {
        this.emitFile({ type: "asset", fileName: page.fileName, source: page.source });
      }
      // Indexable URLs: the home, the All Tools index, and every tool shell.
      const paths = ["/", "/tools.html", ...pages.map((p) => `/${p.fileName}`)];
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: renderSitemap(SITE_ORIGIN, paths),
      });
      this.emitFile({ type: "asset", fileName: "robots.txt", source: renderRobots(SITE_ORIGIN) });
    },
  };
}

/**
 * Emit the on-device OCR engine assets into `dist/ocr/` (BUILD-SPEC-2 §2.2, the
 * lower-confidence scanned-image fallback). tesseract.js spawns a same-origin
 * Web Worker that loads the wasm core and the bundled English language model
 * (`public/ocr/eng.traineddata.gz`, vendored) — all fetched same-origin, never
 * from a CDN. The worker's own response carries a relaxed CSP (`connect-src
 * 'self'` + `'wasm-unsafe-eval'`, see worker/index.ts) so the page stays
 * `connect-src 'none'`. The trio is large but lazy: it loads only when an image
 * is dropped, and the service worker runtime-caches it on first use (like
 * pdf.js), so it is never in the shell bundle and works offline thereafter.
 */
function ocrAssets(): Plugin {
  const coreDir = resolve(REPO_ROOT, "node_modules/tesseract.js-core");
  const workerFile = resolve(REPO_ROOT, "node_modules/tesseract.js/dist/worker.min.js");
  // LSTM cores only (tesseract.js defaults to OEM 1); ship the SIMD build that
  // every modern browser uses plus the plain build as a fallback.
  const coreFiles = [
    "tesseract-core-simd-lstm.wasm.js",
    "tesseract-core-simd-lstm.wasm",
    "tesseract-core-simd-lstm.js",
    "tesseract-core-lstm.wasm.js",
    "tesseract-core-lstm.wasm",
    "tesseract-core-lstm.js",
  ];
  return {
    name: "enklayve-ocr-assets",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "ocr/worker.min.js",
        source: readFileSync(workerFile),
      });
      for (const name of coreFiles) {
        this.emitFile({
          type: "asset",
          fileName: `ocr/${name}`,
          source: readFileSync(resolve(coreDir, name)),
        });
      }
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
  plugins: [staticToolsIndex(), staticSeo(), ocrAssets(), offlinePwa()],
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
    // The app runs in the browser, where mammoth resolves its `browser` package
    // field (an arrayBuffer-based unzip). Node's vitest resolver would otherwise
    // pull mammoth's Node build (which wants a Buffer), so the .docx extraction
    // test would exercise a code path the shipped bundle never uses. Aliasing to
    // the prebuilt browser bundle makes the test mirror production exactly.
    alias: {
      mammoth: resolve(REPO_ROOT, "node_modules/mammoth/mammoth.browser.min.js"),
    },
  },
});
