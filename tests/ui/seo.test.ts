import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToolPage, toolPages, toolPagePath } from "../../scripts/tool-pages";
import { escapeHtml } from "../../scripts/tools-index";
import { renderSitemap, renderRobots, SITE_ORIGIN } from "../../scripts/sitemap";
import { TILES, SUB_TOOLS } from "../../src/tiles/registry";

/** Every indexable tool page: the registered tiles (hubs + My Plan) plus each
 *  hosted sub-tool calculator. */
const PAGE_COUNT = TILES.length + SUB_TOOLS.length;

/**
 * The crawlability surface (BUILD-SPEC.md §11, Phase 11): one pre-rendered shell
 * per tile, a sitemap of every indexable URL, and a robots.txt. These guard all
 * three against registry drift — every tool must keep a stable, indexable home.
 */
describe("per-tile static shells", () => {
  it("emits one shell per registered tile and per hosted sub-tool", () => {
    const pages = toolPages();
    expect(pages.length).toBe(PAGE_COUNT);
    const names = new Set(pages.map((p) => p.fileName));
    expect(names.size).toBe(pages.length);
    for (const tile of TILES) {
      expect(names.has(toolPagePath(tile.id))).toBe(true);
    }
    for (const { tile } of SUB_TOOLS) {
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

describe("home index.html SEO head", () => {
  // The home is the primary indexable page (the SPA shell). Phase 11 added the
  // full discovery + social surface to it; this guards that surface against
  // accidental removal. The canonical/og URLs are self-referential to the
  // production origin, which the release audit explicitly allows.
  const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");

  it("carries a canonical, robots, and a descriptive title + description", () => {
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/" />`);
    expect(html).toMatch(/<meta name="robots" content="index, follow" \/>/);
    expect(html).toMatch(/<title>enklayve<\/title>/);
    expect(html).toMatch(/<meta\s+name="description"/);
  });

  it("carries Open Graph and Twitter card tags for social previews", () => {
    for (const prop of [
      "og:type",
      "og:site_name",
      "og:title",
      "og:description",
      "og:url",
      "og:image",
    ]) {
      expect(html).toContain(`property="${prop}"`);
    }
    expect(html).toContain('name="twitter:card"');
  });

  it("carries WebApplication structured data (JSON-LD) and parses", () => {
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    const data = JSON.parse(m?.[1] ?? "null");
    expect(data["@type"]).toBe("WebApplication");
    expect(data.offers.price).toBe("0");
  });

  it("loads nothing cross-origin (only self-referential absolute URLs)", () => {
    // Same guard the release audit applies: any absolute URL must be on the
    // production origin (canonical/og), never a third-party CDN.
    const crossOrigin = html.match(/\b(?:src|href)\s*=\s*"https?:\/\/(?!enklayve\.com[/"])/gi);
    expect(crossOrigin).toBeNull();
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

  it("has exactly one <loc> per indexable URL (home + index + every tool page)", () => {
    const locs = xml.match(/<loc>/g) ?? [];
    expect(locs.length).toBe(PAGE_COUNT + 2);
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
