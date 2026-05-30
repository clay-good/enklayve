import { describe, it, expect } from "vitest";
import { renderToolPage, toolPages, toolPagePath } from "../../scripts/tool-pages";
import { escapeHtml } from "../../scripts/tools-index";
import { renderSitemap, renderRobots, SITE_ORIGIN } from "../../scripts/sitemap";
import { TILES } from "../../src/tiles/registry";

/**
 * The crawlability surface (BUILD-SPEC.md §11, Phase 11): one pre-rendered shell
 * per tile, a sitemap of every indexable URL, and a robots.txt. These guard all
 * three against registry drift — every tool must keep a stable, indexable home.
 */
describe("per-tile static shells", () => {
  it("emits exactly one shell per registered tile", () => {
    const pages = toolPages();
    expect(pages.length).toBe(TILES.length);
    const names = new Set(pages.map((p) => p.fileName));
    expect(names.size).toBe(pages.length);
    for (const tile of TILES) {
      expect(names.has(toolPagePath(tile.id))).toBe(true);
    }
  });

  it("each shell is a complete document with the tool's name, a canonical, and a link into the app", () => {
    for (const tile of TILES) {
      const html = renderToolPage(tile);
      expect(html).toContain("<!doctype html>");
      expect(html).toContain(`<title>${escapeHtml(tile.title)} · enklayve</title>`);
      // A real, deep link into the live on-device tool.
      expect(html).toContain(`href="/#/${tile.id}"`);
      // A self-referential canonical for search engines.
      expect(html).toContain(
        `<link rel="canonical" href="${SITE_ORIGIN}/${toolPagePath(tile.id)}" />`,
      );
      // Navigation back to the home and the index.
      expect(html).toContain('href="/tools.html"');
    }
  });

  it("loads nothing cross-origin (only same-origin styles inline; external links are anchors)", () => {
    for (const tile of TILES) {
      const html = renderToolPage(tile);
      // No cross-origin <script>/<link rel=stylesheet>/<img> loads.
      expect(/<script[^>]+src\s*=\s*"https?:\/\//i.test(html)).toBe(false);
      expect(/<link[^>]+href\s*=\s*"https?:\/\/(?!enklayve\.com\/tools\/)/i.test(html)).toBe(false);
      expect(/<img[^>]+src\s*=\s*"https?:\/\//i.test(html)).toBe(false);
    }
  });
});

describe("sitemap.xml", () => {
  const pages = toolPages();
  const paths = ["/", "/tools.html", ...pages.map((p) => `/${p.fileName}`)];
  const xml = renderSitemap(SITE_ORIGIN, paths);

  it("is a valid urlset listing the home, the index, and every tool shell", () => {
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/</loc>`);
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/tools.html</loc>`);
    for (const tile of TILES) {
      expect(xml).toContain(`<loc>${SITE_ORIGIN}/${toolPagePath(tile.id)}</loc>`);
    }
  });

  it("has exactly one <loc> per indexable URL (home + index + every tile)", () => {
    const locs = xml.match(/<loc>/g) ?? [];
    expect(locs.length).toBe(TILES.length + 2);
  });
});

describe("robots.txt", () => {
  const robots = renderRobots(SITE_ORIGIN);

  it("allows all crawlers and advertises the sitemap", () => {
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    expect(robots).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
  });
});
