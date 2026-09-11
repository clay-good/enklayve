/**
 * The home page's search-facing head and its no-JavaScript fallback.
 *
 * enklayve renders in the browser, so `index.html` ships as an empty shell —
 * and an empty shell is exactly what a crawler that does not run JavaScript
 * indexes. For a long time that shell said "enklayve" in its `<title>` and
 * nothing at all in its body, which meant the front page of a site with
 * sixty-nine free calculators offered a search engine one word, none of it a
 * word anybody searches for.
 *
 * Both halves are rendered here from the registry and the shared copy in
 * `src/ui/seo.ts`, and injected into `index.html` at build time by the Vite
 * plugin in vite.config.ts, so the claim and the catalog cannot drift apart.
 * The fallback lives inside `#app`, which the shell replaces on boot — so it
 * is the first paint for a person and the whole page for a crawler that never
 * gets that far, and it costs nothing either way.
 */
import { TILES } from "../src/tiles/registry";
import { HOME_TITLE, CATALOG_SUMMARY } from "../src/ui/seo";
import { escapeHtml, TOOL_COUNT, HUB_COUNT } from "./tools-index";
import { SITE_ORIGIN } from "./sitemap";
import { toolPagePath } from "./tool-pages";

/** The home's meta description: the breadth, then the promise, in ~160 characters. */
export const HOME_DESCRIPTION =
  `${TOOL_COUNT} free calculators for take-home pay, federal and state taxes, ` +
  "retirement, mortgages, debt payoff, budgeting, and benefits you may be owed — " +
  "every number computed on your device, nothing ever uploaded.";

/** The social-card headline (Open Graph / Twitter), warmer than the `<title>`. */
export const SOCIAL_TITLE = `enklayve: ${TOOL_COUNT} free, private money tools that show their math`;

/** The placeholders in index.html that the two blocks below replace. */
export const HEAD_MARKER = "<!-- enklayve:head -->";
export const FALLBACK_MARKER = "<!-- enklayve:catalog -->";

/**
 * The home's title, description, social copy, and structured data.
 *
 * The JSON-LD is a `@graph`: the app itself (free, any browser) and an
 * `ItemList` of the twelve topic areas, each pointing at its own crawlable
 * landing page. The full sixty-nine-item list lives on `/tools.html`, which is
 * not precached — keeping it off the home keeps the offline shell small.
 */
export function renderHomeHead(): string {
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        name: "enklayve",
        url: `${SITE_ORIGIN}/`,
        description: HOME_DESCRIPTION,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Any (web browser)",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        featureList: TILES.map((t) => t.title),
      },
      {
        "@type": "ItemList",
        name: `enklayve calculators, in ${HUB_COUNT} topic areas`,
        numberOfItems: TILES.length,
        itemListElement: TILES.map((t, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: t.title,
          description: t.description,
          url: `${SITE_ORIGIN}/${toolPagePath(t.id)}`,
        })),
      },
    ],
  };

  return [
    `<title>${escapeHtml(HOME_TITLE)}</title>`,
    `    <meta name="description" content="${escapeHtml(HOME_DESCRIPTION)}" />`,
    `    <meta property="og:title" content="${escapeHtml(SOCIAL_TITLE)}" />`,
    `    <meta property="og:description" content="${escapeHtml(HOME_DESCRIPTION)}" />`,
    `    <meta name="twitter:title" content="${escapeHtml(SOCIAL_TITLE)}" />`,
    `    <meta name="twitter:description" content="${escapeHtml(HOME_DESCRIPTION)}" />`,
    `    <script type="application/ld+json">${JSON.stringify(graph)}</script>`,
  ].join("\n");
}

/**
 * The crawlable, no-JavaScript home: what the site is, what it costs, and every
 * topic area by name with the calculators it holds, each linking to a real
 * static page. The shell replaces it the moment it boots.
 */
export function renderHomeFallback(): string {
  // Each area, not each calculator. All sixty-nine are named on /tools.html,
  // which this links to and the sitemap lists — and naming them here too would
  // cost about a kilobyte gzipped of a precached shell with four to spare.
  const areas = TILES.map(
    (hub) =>
      `        <li><a href="/${toolPagePath(hub.id)}">${escapeHtml(hub.title)}</a>: ` +
      `${escapeHtml(hub.description)}</li>`,
  ).join("\n");

  return `<div class="boot-fallback">
      <h1>Free personal finance calculators that never send your data anywhere</h1>
      <p>${escapeHtml(HOME_DESCRIPTION)}</p>
      <p>${escapeHtml(CATALOG_SUMMARY)}</p>
      <h2>${TOOL_COUNT} calculators, in ${HUB_COUNT} areas</h2>
      <ul>
${areas}
      </ul>
      <p><a href="/tools.html">See all ${TOOL_COUNT} calculators →</a></p>
    </div>`;
}

/** Inject both blocks into the index.html source. */
export function injectHomeSeo(html: string): string {
  return html.replace(HEAD_MARKER, renderHomeHead()).replace(FALLBACK_MARKER, renderHomeFallback());
}
