/**
 * The pre-rendered All Tools index (BUILD-SPEC-2 §1.2). A static, self-contained,
 * crawlable HTML page with a real anchor per tool, so every tool has a stable,
 * linkable, indexable home even though the app itself is a fragment-routed single
 * page. Emitted into the build by the Vite plugin in vite.config.ts; rendered
 * here (not inline) so a test can guard it against registry drift. Styling is
 * inline — the CSP allows 'unsafe-inline' for styles — so the file depends on no
 * hashed asset names.
 *
 * This is the page a search for "free personal finance calculators" should be
 * able to land on: it names the count, names every calculator, and links each
 * one to its own landing page. It is not precached, so unlike the home it can
 * afford to say everything.
 */
import { TILES, SUB_TOOLS } from "../src/tiles/registry";
import { SITE_ORIGIN } from "./sitemap";
import { CATALOG_SUMMARY } from "../src/ui/seo";

/** How many calculators the site offers, and how many topic areas they sit in.
 *  Read off the registry rather than written down, so no page can claim a count
 *  the catalog does not back. */
export const TOOL_COUNT = SUB_TOOLS.length;
export const HUB_COUNT = TILES.length;

/** Escape text for safe interpolation into HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** This page's own title and description, shared with the JSON-LD below. */
/** The public URL of this page: the host serves it clean, without the
 *  extension its file carries (see toolPageUrl in tool-pages.ts). */
export const INDEX_PAGE_URL = "tools";

export const INDEX_TITLE = `All ${TOOL_COUNT} free personal finance calculators · enklayve`;
/** Kept inside the ~160 characters a search result actually shows (see
 *  HOME_DESCRIPTION); at 220 the "free" and the privacy promise were cut off. */
export const INDEX_DESCRIPTION =
  `Every free enklayve calculator, in ${HUB_COUNT} topic areas: pay and taxes, self-employment, ` +
  "investing, retirement, debt, budgeting, insurance, and benefits you may be owed.";

/**
 * Shared page furniture for the static pages: a readable measure, system fonts,
 * and touch-sized tap targets. Kept in one string so the index and the per-tool
 * shells cannot drift into looking like two different sites — and so the mobile
 * rules (a single column, links a thumb can hit, no horizontal scroll) are
 * written once.
 */
export const PAGE_STYLE = `
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      body {
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        max-width: 48rem;
        margin: 0 auto;
        padding: 2rem 1.25rem 3rem;
        color: #1e1b2e;
        background: #faf8ff;
        line-height: 1.55;
        overflow-wrap: break-word;
        -webkit-text-size-adjust: 100%;
      }
      h1 { color: #6d28d9; margin-bottom: 0.25rem; font-size: 1.85rem; line-height: 1.2; }
      h2 { color: #5b21b6; margin: 1.75rem 0 0.25rem; font-size: 1.15rem; }
      h2 a { color: #5b21b6; }
      p.lede { color: #5b5570; margin-top: 0; font-size: 1.05rem; }
      p.hubdesc { color: #5b5570; margin: 0 0 0.5rem; font-size: 0.95rem; }
      a { color: #6d28d9; font-weight: 600; text-decoration: none; }
      a:hover { text-decoration: underline; }
      nav { margin-bottom: 1.25rem; }
      nav a { font-weight: 700; }
      .d { color: #5b5570; font-weight: 400; }
      .note { color: #5b5570; font-size: 0.85rem; margin-top: 2.5rem; }
      ul.tools { list-style: none; padding: 0; margin: 0; }
      ul.tools li { padding: 0.3rem 0; }
      ul.tools a { display: inline-block; padding: 0.35rem 0; }
      @media (max-width: 480px) {
        body { padding: 1.25rem 1rem 2.5rem; }
        h1 { font-size: 1.5rem; }
        ul.tools li { padding: 0.15rem 0; }
        ul.tools a { padding: 0.6rem 0; }
      }`;

/** A BreadcrumbList for a page one level under the home. */
export function breadcrumb(items: { name: string; url: string }[]): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  });
}

/** Render the full static All Tools index document. */
export function renderToolsIndex(): string {
  // One section per topic hub. The hub heading links to the hub's own crawlable
  // landing page (a real URL a search engine can rank, rather than a fragment
  // it cannot), with a direct link into the live app beside it for a reader who
  // wants the tool rather than the explanation. Each calculator it hosts links
  // to its own pre-rendered landing page, so every calculator is named here and
  // every per-tool page is reachable in one hop from the index.
  const groups = TILES.map((hub) => {
    const subs = SUB_TOOLS.filter((s) => s.hubId === hub.id).map((s) => s.tile);
    const items = subs
      .map(
        (t) =>
          `        <li><a href="/tools/${encodeURIComponent(t.id)}">${escapeHtml(t.title)}</a>` +
          `<span class="d">, ${escapeHtml(t.description)}</span></li>`,
      )
      .join("\n");
    return (
      `      <section>\n` +
      `        <h2><a href="/tools/${encodeURIComponent(hub.id)}">${escapeHtml(hub.title)}</a></h2>\n` +
      `        <p class="hubdesc">${escapeHtml(hub.description)} ` +
      `<a href="/#/${encodeURIComponent(hub.id)}">Open ${escapeHtml(hub.title)} →</a></p>\n` +
      `        <ul class="tools">\n${items}\n        </ul>\n` +
      `      </section>`
    );
  }).join("\n");

  // The whole catalog as structured data, so a search engine can read the list
  // as a list rather than inferring one from the markup.
  const itemList = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `enklayve's ${TOOL_COUNT} free personal finance calculators`,
    numberOfItems: SUB_TOOLS.length,
    itemListElement: SUB_TOOLS.map(({ tile }, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: tile.title,
      description: tile.description,
      url: `${SITE_ORIGIN}/tools/${encodeURIComponent(tile.id)}`,
    })),
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escapeHtml(INDEX_TITLE)}</title>
    <meta name="description" content="${escapeHtml(INDEX_DESCRIPTION)}" />
    <link rel="canonical" href="${SITE_ORIGIN}/${INDEX_PAGE_URL}" />
    <meta name="robots" content="index, follow" />
    <meta name="theme-color" content="#6D28D9" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="enklayve" />
    <meta property="og:title" content="${escapeHtml(INDEX_TITLE)}" />
    <meta property="og:description" content="${escapeHtml(INDEX_DESCRIPTION)}" />
    <meta property="og:url" content="${SITE_ORIGIN}/${INDEX_PAGE_URL}" />
    <meta property="og:image" content="${SITE_ORIGIN}/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(INDEX_TITLE)}" />
    <meta name="twitter:description" content="${escapeHtml(INDEX_DESCRIPTION)}" />
    <meta name="twitter:image" content="${SITE_ORIGIN}/og-image.png" />
    <script type="application/ld+json">${itemList}</script>
    <script type="application/ld+json">${breadcrumb([
      { name: "enklayve", url: `${SITE_ORIGIN}/` },
      { name: "All tools", url: `${SITE_ORIGIN}/${INDEX_PAGE_URL}` },
    ])}</script>
    <style>${PAGE_STYLE}
    </style>
  </head>
  <body>
    <nav><a href="/">← enklayve home</a> · <a href="/about">Why enklayve</a></nav>
    <h1>All ${TOOL_COUNT} free calculators</h1>
    <p class="lede">
      ${escapeHtml(CATALOG_SUMMARY)} Every one runs entirely on your device, nothing is ever
      sent anywhere, and every number shows the public rule behind it.
    </p>
    <main>
${groups}
    </main>
    <p class="note">
      Free forever, no account, no ads, no tracking. Educational information for U.S. taxes and
      benefits, not financial, tax, investment, or legal advice.
    </p>
  </body>
</html>
`;
}
