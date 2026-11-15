import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  renderToolPage,
  searchName,
  toolPages,
  toolPagePath,
  toolPageUrl,
} from "../../scripts/tool-pages";
import {
  statePages,
  stateInfos,
  statePageUrl,
  workedExample,
  STATES_INDEX_URL,
} from "../../scripts/state-pages";
import { guidePages, GUIDES } from "../../scripts/guides";
import { TAX_YEAR } from "../../scripts/shards";
import { US_STATES } from "../../src/data/usStates";
import { ANTI_BUDGET_SECTIONS } from "../../src/ui/guideCopy";
import { loadLazyHows } from "../../src/tiles/lazy";
import { pmiEndDateTile } from "../../src/tiles/pmiEndDate";
import { escapeHtml } from "../../scripts/tools-index";
import { renderSitemap, renderRobots, SITE_ORIGIN } from "../../scripts/sitemap";
import { indexablePaths } from "../../scripts/indexable";
import { injectHomeSeo, HEAD_MARKER, FALLBACK_MARKER } from "../../scripts/home-page";
import { renderAboutPage, ABOUT_PAGE_PATH, ABOUT_PAGE_URL } from "../../scripts/about-page";
import { renderToolsIndex, INDEX_PAGE_URL } from "../../scripts/tools-index";
import { ABOUT_POINTS, US_RESOURCES } from "../../src/ui/aboutCopy";
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
      // Keyword-carrying title: the name people search for, then what it costs.
      expect(html).toContain(
        `<title>${escapeHtml(searchName(tile, true))} · Free &amp; private · enklayve</title>`,
      );
      // A real, deep link into the live on-device tool.
      expect(html).toContain(`href="/#/${tile.id}"`);
      // A self-referential canonical for search engines.
      expect(html).toContain(
        `<link rel="canonical" href="${SITE_ORIGIN}/${toolPageUrl(tile.id)}" />`,
      );
      // Navigation back to the home and the index.
      expect(html).toContain(`href="/${INDEX_PAGE_URL}"`);
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
        expect(html).toContain(`href="/${toolPageUrl(s.tile.id)}"`);
      }
    }
    for (const hub of TILES) {
      const html = renderToolPage(hub);
      for (const s of SUB_TOOLS.filter((s) => s.hubId === hub.id)) {
        expect(html).toContain(`href="/${toolPageUrl(s.tile.id)}"`);
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
      expect(html).toContain(`href="/${toolPageUrl(hub.id)}"`);
    }
    expect(html).toContain(`href="/${INDEX_PAGE_URL}"`);
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

/**
 * "Why enklayve" is the page that answers "is this free?" and "where does my
 * data go?", and it lived only at the fragment route `#/about` — a URL no
 * crawler can index. The static page mirrors it from the same copy.
 */
describe("static Why enklayve page", () => {
  const html = renderAboutPage();

  it("renders the same argument the in-app view makes, from the same strings", () => {
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<h1>Why enklayve</h1>");
    for (const point of ABOUT_POINTS) {
      expect(html).toContain(escapeHtml(point.title));
    }
    for (const r of US_RESOURCES) {
      expect(html).toContain(`href="${escapeHtml(r.url)}"`);
    }
  });

  it("names every topic area, and links All Tools for the calculators", () => {
    for (const hub of TILES) {
      expect(html).toContain(`href="/${toolPageUrl(hub.id)}"`);
      expect(html).toContain(escapeHtml(hub.title));
    }
    expect(html).toContain(`href="/${INDEX_PAGE_URL}"`);
    expect(html).toContain(`${SUB_TOOLS.length} calculators, in ${TILES.length} areas`);
  });

  it("carries a canonical, an AboutPage that states the price, and a breadcrumb", () => {
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/${ABOUT_PAGE_URL}" />`);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(blocks.length).toBe(2);
    const [about, crumbs] = blocks.map((m) => JSON.parse(m[1]!));
    expect(about["@type"]).toBe("AboutPage");
    expect(about.mainEntity.isAccessibleForFree).toBe(true);
    expect(about.mainEntity.offers.price).toBe("0");
    expect(crumbs["@type"]).toBe("BreadcrumbList");
  });

  it("loads nothing cross-origin (the resource links are anchors)", () => {
    expect(/<script[^>]+src\s*=\s*"https?:\/\//i.test(html)).toBe(false);
    expect(/<link[^>]+href\s*=\s*"https?:\/\/(?!enklayve\.com\/)/i.test(html)).toBe(false);
    expect(/<img[^>]+src\s*=\s*"https?:\/\//i.test(html)).toBe(false);
  });
});

describe("sitemap.xml", () => {
  // The build's own list, not a second copy of it.
  const xml = renderSitemap(SITE_ORIGIN, indexablePaths());

  it("is a valid urlset listing the home, both site pages, and every tool shell", () => {
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/</loc>`);
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/${INDEX_PAGE_URL}</loc>`);
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/${ABOUT_PAGE_URL}</loc>`);
    for (const tile of TILES) {
      expect(xml).toContain(`<loc>${SITE_ORIGIN}/${toolPageUrl(tile.id)}</loc>`);
    }
  });

  it("has exactly one <loc> per indexable URL (home, site pages, tool, state and guide pages)", () => {
    const locs = xml.match(/<loc>/g) ?? [];
    expect(locs.length).toBe(PAGE_COUNT + 3 + statePages().length + guidePages().length);
    for (const { name } of US_STATES) {
      expect(xml).toContain(`<loc>${SITE_ORIGIN}/${statePageUrl(name)}</loc>`);
    }
  });

  /**
   * A sitemap of redirects. Every entry named the `.html` file rather than the
   * URL the host answers with a 200, so all eighty-four pointed a crawler at a
   * 307 — and each page's canonical named that same redirecting URL.
   */
  it("lists no URL ending in .html, because none of those are served", () => {
    expect(xml).not.toMatch(/\.html/);
  });
});

/**
 * What a search result actually shows.
 *
 * Google renders roughly the first 160 characters of a description and cuts the
 * rest mid-word. The home's ran to 204 and the All Tools index's to 220, which
 * meant the clause carrying the whole argument — free, and computed on your
 * device — was cut from the only line most people ever read about this site.
 * Every page's description has to fit in the window it is shown in.
 */
describe("every page's description fits a search result", () => {
  const pages: [string, string][] = [
    ["home", injectHomeSeo(readFileSync(resolve(__dirname, "../../index.html"), "utf8"))],
    ["tools.html", renderToolsIndex()],
    [ABOUT_PAGE_PATH, renderAboutPage()],
    ...toolPages().map(({ fileName, source }) => [fileName, source] as [string, string]),
    ...[...statePages(), ...guidePages()].map(
      ({ fileName, source }) => [fileName, source] as [string, string],
    ),
  ];

  it("says enough to be worth clicking, and not so much that it is cut off", () => {
    const wrong: string[] = [];
    for (const [name, html] of pages) {
      const d = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
      if (!d) {
        wrong.push(`${name}: no description`);
        continue;
      }
      // Measured as rendered, not as source: "&amp;" is one character on screen.
      const shown = d.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
      if (shown.length < 70 || shown.length > 170) {
        wrong.push(`${name}: ${shown.length} characters`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("leads every title with the page's own subject, not the brand", () => {
    // The first words are the half a search engine weighs and the half a
    // searcher scans, so "enklayve" belongs at the end of all of them.
    for (const [name, html] of pages) {
      const t = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
      expect(t.length, name).toBeGreaterThan(10);
      expect(t.startsWith("enklayve"), name).toBe(false);
      expect(t.endsWith("enklayve"), name).toBe(true);
    }
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

describe("a tool whose explanation loads on demand still has it on its crawl page", () => {
  it("writes the loaded how block into the page", async () => {
    await loadLazyHows();
    const html = renderToolPage(pmiEndDateTile, "home-purchases");
    expect(html).toContain("Homeowners Protection Act sets three dates");
  });
});

/**
 * The searches people actually type name the thing and the year: "take-home
 * pay calculator 2026", not "Take-Home Pay". A tool page whose title says
 * neither loses that query to one that does.
 */
describe("tool page titles carry the search", () => {
  it("names the kind of tool, and the most-searched carry the tax year", () => {
    for (const { tile } of SUB_TOOLS) {
      expect(searchName(tile, false), tile.id).toMatch(
        /calculator|checker|estimat|planner|screener|checklist|chooser|explorer|optimizer|picker|timeline|sequences|limits|windows|triage|\?$/i,
      );
    }
    const takeHome = SUB_TOOLS.find((s) => s.tile.id === "take-home")!.tile;
    expect(searchName(takeHome, false)).toBe(`Take-Home Pay Calculator ${TAX_YEAR}`);
  });
});

/**
 * One page per state, because "California paycheck calculator" is a search
 * and `/tools/take-home` names no state. Its examples must be the numbers the
 * calculator itself would show, not a second model of them.
 */
describe("per-state paycheck pages", () => {
  const pages = statePages();
  const infos = stateInfos();

  it("covers all fifty states and DC, plus an index that links every one", () => {
    expect(infos.length).toBe(51);
    expect(pages.length).toBe(52);
    const index = pages.find((p) => p.url === STATES_INDEX_URL)!.source;
    for (const { name } of US_STATES) expect(index).toContain(`href="/${statePageUrl(name)}"`);
  });

  it("prints the engine's own take-home figure, and deep-links the calculator to the state", () => {
    const ca = infos.find((i) => i.code === "CA")!;
    const html = pages.find((p) => p.url === statePageUrl("California"))!.source;
    const takeHome = Math.round(workedExample(ca.jurisdiction, 60_000).totals.takeHome.toNumber());
    expect(html).toContain(`$${takeHome.toLocaleString("en-US")}`);
    expect(html).toContain('href="/#/paycheck-taxes?tool=take-home&st=ca&fs=single&w=80000"');
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/states/california" />`);
  });

  it("says plainly when a state has no income tax on wages", () => {
    const html = pages.find((p) => p.url === statePageUrl("Texas"))!.source;
    expect(html).toContain("Texas has no income tax on wages");
  });

  it("names the county a mandatory local tax is computed for", () => {
    const html = pages.find((p) => p.url === statePageUrl("Maryland"))!.source;
    expect(html).toContain("Montgomery County");
  });

  it("loads nothing cross-origin", () => {
    for (const { source } of pages) {
      expect(/<script[^>]+src\s*=\s*"https?:\/\//i.test(source)).toBe(false);
      expect(/<link[^>]+href\s*=\s*"https?:\/\/(?!enklayve\.com\/)/i.test(source)).toBe(false);
    }
  });
});

/**
 * The anti-budget is what the site leads with, and it lived only on the
 * browser-rendered home, invisible to a crawler. The guide carries the same
 * words the home does.
 */
describe("guides", () => {
  it("renders the home's anti-budget copy, word for word", () => {
    const html = guidePages().find((p) => p.url === "guides/anti-budget")!.source;
    for (const s of ANTI_BUDGET_SECTIONS) expect(html).toContain(escapeHtml(s.body));
  });

  it("links a real tool page from every step", () => {
    for (const g of GUIDES) {
      for (const step of g.steps) {
        expect(step.tools.length, `${g.slug}: ${step.heading}`).toBeGreaterThan(0);
        for (const id of step.tools) {
          expect(
            SUB_TOOLS.some((s) => s.tile.id === id),
            `${g.slug} links ${id}`,
          ).toBe(true);
        }
      }
    }
  });
});
