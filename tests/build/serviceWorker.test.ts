import { describe, it, expect } from "vitest";
import { renderServiceWorker, renderWebManifest, WEB_MANIFEST } from "../../scripts/service-worker";

/**
 * The offline service worker and web app manifest (BUILD-SPEC.md §8, §11). The
 * renderers are pure, so a test can guard the generated output (mirroring the
 * static tools-index guard).
 */
describe("service worker", () => {
  const sw = renderServiceWorker(
    ["/index.html", "/assets/index-abc.js", "/assets/index-abc.css", "/", "/index.html"],
    "abc123def456",
  );

  it("names the cache after the build version", () => {
    expect(sw).toContain('const CACHE = "enklayve-abc123def456";');
  });

  it("precaches the shell, deduped and sorted", () => {
    expect(sw).toContain('"/assets/index-abc.css"');
    expect(sw).toContain('"/assets/index-abc.js"');
    expect(sw).toContain('"/index.html"');
    // Deduped: "/index.html" appears once in the precache array.
    const precache = sw.slice(sw.indexOf("PRECACHE = ["), sw.indexOf("];"));
    expect(precache.match(/"\/index\.html"/g)?.length).toBe(1);
  });

  it("handles install, activate, and fetch", () => {
    expect(sw).toContain('addEventListener("install"');
    expect(sw).toContain('addEventListener("activate"');
    expect(sw).toContain('addEventListener("fetch"');
    // Drops stale caches on activate.
    expect(sw).toContain("caches.delete");
    // Same-origin only; navigations fall back to the cached shell.
    expect(sw).toContain("url.origin !== self.location.origin");
    expect(sw).toContain('caches.match("/index.html")');
  });

  it("only ever fetches GET requests", () => {
    expect(sw).toContain('request.method !== "GET"');
  });
});

describe("web app manifest", () => {
  it("is valid JSON describing an installable, royal-purple app", () => {
    const manifest = JSON.parse(renderWebManifest());
    expect(manifest.name).toBe("enklayve");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.theme_color).toBe("#6D28D9");
    expect(manifest.icons[0].src).toBe("/icon.svg");
    expect(manifest.icons[0].purpose).toContain("maskable");
  });

  it("matches the exported manifest object", () => {
    expect(JSON.parse(renderWebManifest())).toEqual(WEB_MANIFEST);
  });
});
