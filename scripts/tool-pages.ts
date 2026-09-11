/**
 * Pre-rendered per-tile shells (BUILD-SPEC.md §11, Phase 11; the roughlogic
 * pattern). enklayve is a fragment-routed single page, so on its own no
 * individual tool has a crawlable URL. This emits one static, self-contained
 * HTML page per tile, served at `/tools/<id>`, carrying the tool's name, what it
 * does, how it works, what it covers, its trusted sources, and links to the
 * tools next to it, with a prominent link into the live on-device tool. Search
 * engines get a real, indexable landing page for every tool; people who land on
 * one are one click from the app.
 *
 * Rendered here (not inline in the Vite plugin) so a test guards it against
 * registry drift. Styling is inline (the CSP allows 'unsafe-inline' for styles)
 * and nothing cross-origin is *loaded* — only the "learn more" anchors point
 * out, exactly as the live app does — so the privacy promise is intact.
 */
import { TILES, SUB_TOOLS } from "../src/tiles/registry";
import type { TileDefinition } from "../src/tiles/types";
import { escapeHtml, PAGE_STYLE, breadcrumb, INDEX_PAGE_URL } from "./tools-index";
import { SITE_ORIGIN } from "./sitemap";

/** The build path for a tile's shell — the file the bundle emits. */
export function toolPagePath(id: string): string {
  return `tools/${encodeURIComponent(id)}.html`;
}

/**
 * The public URL of a tile's shell, which is NOT its filename.
 *
 * The host serves these pages with clean URLs: a request for
 * `/tools/take-home.html` is answered with a 307 to `/tools/take-home`, and the
 * extensionless URL is the one that returns 200. Every canonical, every
 * `og:url`, every breadcrumb and every sitemap entry here named the `.html`
 * form — so all eighty-one pages declared as canonical a URL that redirects
 * away from them, and the sitemap handed a crawler eighty-one redirects. The
 * file keeps its extension; the URL it is advertised under does not.
 */
export function toolPageUrl(id: string): string {
  return `tools/${encodeURIComponent(id)}`;
}

/** Every tile that has a page, by id — used to resolve sibling and related links. */
const TITLE_BY_ID = new Map<string, string>([
  ...TILES.map((t) => [t.id, t.title] as const),
  ...SUB_TOOLS.map(({ tile }) => [tile.id, tile.title] as const),
]);

const EXTRA_STYLE = `
      .open {
        display: inline-block;
        margin: 1.25rem 0 0.5rem;
        padding: 0.75rem 1.25rem;
        background: #6d28d9;
        color: #fff;
        border-radius: 8px;
      }
      .open:hover { background: #5b21b6; text-decoration: none; }
      .covers { color: #5b5570; font-size: 0.9rem; margin: 0.25rem 0 0; }
      ul.plain { padding-left: 1.1rem; }
      ul.plain li { padding: 0.2rem 0; }
      @media (max-width: 480px) {
        .open { display: block; text-align: center; }
      }`;

/** A list of links to other tool pages, titles resolved from the registry. */
function linkList(items: { id: string; note?: string }[]): string {
  return items
    .filter((it) => TITLE_BY_ID.has(it.id))
    .map(
      (it) =>
        `        <li><a href="/${toolPageUrl(it.id)}">${escapeHtml(TITLE_BY_ID.get(it.id)!)}</a>` +
        (it.note ? `<span class="d">, ${escapeHtml(it.note)}</span>` : "") +
        `</li>`,
    )
    .join("\n");
}

function section(heading: string, body: string): string {
  return body ? `    <h2>${heading}</h2>\n${body}\n` : "";
}

/**
 * Render the static landing page for one tile.
 *
 * `hubId` is the hub that hosts this calculator (absent for a hub's own page).
 * It decides two things: the deep link into the live app, and which other tools
 * the page points at — the calculators beside it in the same hub for a sub-tool,
 * the calculators it hosts for a hub. Those links are the whole reason the
 * sixty-nine pages read as one site to a crawler rather than as sixty-nine
 * orphans reachable only from the sitemap.
 */
export function renderToolPage(tile: TileDefinition, hubId?: string): string {
  const canonical = `${SITE_ORIGIN}/${toolPageUrl(tile.id)}`;
  const appUrl = hubId
    ? `/#/${encodeURIComponent(hubId)}?tool=${encodeURIComponent(tile.id)}`
    : `/#/${encodeURIComponent(tile.id)}`;
  const title = `${tile.title} · Free & private · enklayve`;
  const description = `${tile.description} Free, with no account, and computed entirely on your device.`;

  const how = (tile.how ?? "")
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `      <p>${escapeHtml(p)}</p>`)
    .join("\n");

  const resources = (tile.resources ?? [])
    .map(
      (r) =>
        `        <li><a href="${escapeHtml(r.url)}" rel="noopener noreferrer">${escapeHtml(r.label)}</a></li>`,
    )
    .join("\n");

  // A hub's page lists the calculators it holds; a calculator's page lists the
  // others in its hub, plus the sibling tools the tile itself nominates.
  const hosted = SUB_TOOLS.filter((s) => s.hubId === tile.id).map(({ tile: t }) => ({ id: t.id }));
  const siblings = hubId
    ? SUB_TOOLS.filter((s) => s.hubId === hubId && s.tile.id !== tile.id).map(({ tile: t }) => ({
        id: t.id,
      }))
    : [];
  const related = (tile.related ?? []).map((r) => ({ id: r.tool ?? r.hubId, note: r.note }));

  const covers = tile.keywords.length
    ? `    <p class="covers">Covers: ${escapeHtml(tile.keywords.join(", "))}.</p>\n`
    : "";

  const app = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: tile.title,
    url: canonical,
    description: tile.description,
    applicationCategory: "FinanceApplication",
    applicationSubCategory: "Calculator",
    operatingSystem: "Any (web browser)",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    keywords: tile.keywords.join(", "),
    provider: { "@type": "Organization", name: "enklayve", url: `${SITE_ORIGIN}/` },
  };

  const crumbs = breadcrumb([
    { name: "enklayve", url: `${SITE_ORIGIN}/` },
    { name: "All tools", url: `${SITE_ORIGIN}/${INDEX_PAGE_URL}` },
    ...(hubId && TITLE_BY_ID.has(hubId)
      ? [{ name: TITLE_BY_ID.get(hubId)!, url: `${SITE_ORIGIN}/${toolPageUrl(hubId)}` }]
      : []),
    { name: tile.title, url: canonical },
  ]);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="index, follow" />
    <meta name="theme-color" content="#6D28D9" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="enklayve" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${SITE_ORIGIN}/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${SITE_ORIGIN}/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(app)}</script>
    <script type="application/ld+json">${crumbs}</script>
    <style>${PAGE_STYLE}${EXTRA_STYLE}
    </style>
  </head>
  <body>
    <nav><a href="/">← enklayve home</a> · <a href="/tools">All tools</a> · <a href="/about">Why enklayve</a></nav>
    <h1>${escapeHtml(tile.title)}</h1>
    <p class="lede">${escapeHtml(tile.description)}</p>
${covers}    <a class="open" href="${appUrl}">Open the ${escapeHtml(tile.title)} tool →</a>
${section("How this works", how)}${section(
    hosted.length ? "Calculators in this area" : "Others in this area",
    hosted.length || siblings.length
      ? `    <ul class="tools">\n${linkList(hosted.length ? hosted : siblings)}\n    </ul>`
      : "",
  )}${section(
    "Related tools",
    related.length ? `    <ul class="tools">\n${linkList(related)}\n    </ul>` : "",
  )}${section(
    "Learn more",
    resources ? `    <ul class="plain">\n${resources}\n    </ul>` : "",
  )}    <p class="note">
      Free forever, with no account and no ads. Computed entirely on your device for U.S. taxes
      and benefits — nothing is ever sent anywhere. Educational information, not financial, tax,
      investment, or legal advice.
    </p>
    <p><a href="/tools">See all enklayve calculators →</a></p>
  </body>
</html>
`;
}

/**
 * Every crawlable shell, as build assets ({ fileName, source }): one per
 * registered tile (the hubs + My Plan) and one per hosted sub-tool calculator
 * (its "Open" link deep-links into the hub at `?tool=<id>`), so every tool keeps
 * a stable, indexable landing page after the consolidation.
 */
export function toolPages(): { id: string; fileName: string; source: string }[] {
  return [
    ...TILES.map((t) => ({ id: t.id, fileName: toolPagePath(t.id), source: renderToolPage(t) })),
    ...SUB_TOOLS.map(({ tile, hubId }) => ({
      id: tile.id,
      fileName: toolPagePath(tile.id),
      source: renderToolPage(tile, hubId),
    })),
  ];
}
