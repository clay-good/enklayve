import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToolPage, toolPages, toolPagePath } from "../../scripts/tool-pages";
import { escapeHtml } from "../../scripts/tools-index";
import { renderSitemap, renderRobots, SITE_ORIGIN } from "../../scripts/sitemap";
import { injectHomeSeo, HEAD_MARKER, FALLBACK_MARKER } from "../../scripts/home-page";
import { HOME_TITLE } from "../../src/ui/seo";
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
      // Keyword-carrying title: the tool's own name, then what it costs.
      expect(html).toContain(
        `<title>${escapeHtml(tile.title)} · Free &amp; private · enklayve</title>`,
      );
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

  it("carries SoftwareApplication and BreadcrumbList structured data that parses", () => {
    for (const { tile, hubId } of SUB_TOOLS) {
      const html = renderToolPage(tile, hubId);
      const blocks = [
        ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
      ];
      expect(blocks.length).toBe(2);
      const [app, crumbs] = blocks.map((m) => JSON.parse(m[1]!));
      expect(app["@type"]).toBe("SoftwareApplication");
      expect(app.isAccessibleForFree).toBe(true);
      expect(app.offers.price).toBe("0");
      expect(crumbs["@type"]).toBe("BreadcrumbList");
      // home → All tools → the hub that hosts it → this tool.
      expect(crumbs.itemListElement.length).toBe(4);
      expect(crumbs.itemListElement.at(-1).name).toBe(tile.title);
    }
  });

  /**
   * Sixty-nine landing pages reachable only from the sitemap are sixty-nine
   * orphans. Every calculator's page links the others in its hub, so a crawler
   * that finds one finds the rest, and so does a reader.
   */
  it("links the other calculators in the same hub, and the hub lists the ones it holds", () => {
    for (const { tile, hubId } of SUB_TOOLS) {
      const siblings = SUB_TOOLS.filter((s) => s.hubId === hubId && s.tile.id !== tile.id);
      const html = renderToolPage(tile, hubId);
      for (const s of siblings) {
        expect(html).toContain(`href="/${toolPagePath(s.tile.id)}"`);
      }
    }
    for (const hub of TILES) {
      const html = renderToolPage(hub);
      for (const s of SUB_TOOLS.filter((s) => s.hubId === hub.id)) {
        expect(html).toContain(`href="/${toolPagePath(s.tile.id)}"`);
      }
    }
  });

  it("deep-links a hosted calculator into its hub, already switched to it", () => {
    const { tile, hubId } = SUB_TOOLS[0]!;
    expect(renderToolPage(tile, hubId)).toContain(`href="/#/${hubId}?tool=${tile.id}"`);
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
  // The home is the primary indexable page (the SPA shell), and its head is
  // filled in at build time from the registry (scripts/home-page.ts) so the
  // counts and the catalog it claims cannot drift from the tools that exist.
  // This guards the shipped head — the injected result, not the template.
  const source = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
  const html = injectHomeSeo(source);

  it("leaves no un-injected marker behind", () => {
    expect(source).toContain(HEAD_MARKER);
    expect(source).toContain(FALLBACK_MARKER);
    expect(html).not.toContain(HEAD_MARKER);
    expect(html).not.toContain(FALLBACK_MARKER);
  });

  it("carries a canonical, robots, and a keyword-carrying title + description", () => {
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/" />`);
    expect(html).toMatch(/<meta name="robots" content="index, follow" \/>/);
    // The shell sets the same string as the document title on the home, so the
    // tab and the search result say one thing.
    expect(html).toContain(`<title>${escapeHtml(HOME_TITLE)}</title>`);
    expect(HOME_TITLE.toLowerCase()).toContain("free");
    expect(html).toMatch(/<meta name="description" content="[^"]{80,}"/);
  });

  it("names the catalog for a crawler that never runs the app", () => {
    // Without this block the front page of a site with sixty-nine calculators
    // is an empty <div> to anything that does not execute JavaScript.
    for (const hub of TILES) {
      expect(html).toContain(escapeHtml(hub.title));
      expect(html).toContain(`href="/${toolPagePath(hub.id)}"`);
    }
    expect(html).toContain('href="/tools.html"');
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
    // The social card image must be a raster: SVG og:images don't render on
    // Twitter/X, Facebook, LinkedIn, Slack, or iMessage, so a vector here means
    // no preview anywhere the site is shared.
    expect(html).toMatch(/property="og:image" content="[^"]+\.png"/);
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });

  it("carries WebApplication and ItemList structured data (JSON-LD) that parses", () => {
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    const data = JSON.parse(m?.[1] ?? "null");
    const app = data["@graph"].find((n: { "@type": string }) => n["@type"] === "WebApplication");
    const list = data["@graph"].find((n: { "@type": string }) => n["@type"] === "ItemList");
    expect(app.offers.price).toBe("0");
    // The feature list is the catalog, so it cannot understate what is on offer.
    expect(app.featureList.length).toBe(TILES.length);
    expect(list.itemListElement.length).toBe(TILES.length);
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
