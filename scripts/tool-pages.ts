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
import { TAX_YEAR } from "./shards";

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

/**
 * The name a person types into a search box, where it differs from the name
 * the tool wears in the app. "Take-Home Pay" is a fine heading inside a
 * calculator; nobody searches for it. They search "take-home pay calculator
 * 2026", and a page whose title never says "calculator" or the year loses that
 * query to one that does. `{year}` is the federal shard's tax year, so these
 * roll with the data rather than with someone's memory.
 */
const SEARCH_NAMES: Record<string, string> = {
  "take-home": "Take-Home Pay Calculator {year}",
  w4: "W-4 Withholding Calculator {year}",
  "hourly-salary": "Hourly to Salary Calculator",
  "federal-income-tax": "Federal Income Tax Calculator {year}",
  "filing-jointly-vs-separately": "Married Filing Jointly vs Separately Calculator",
  "marginal-explorer": "Marginal Tax Rate Calculator {year}",
  "amt-screener": "AMT Calculator {year}",
  "gift-tax": "Gift Tax Calculator {year}",
  "self-employment-tax": "Self-Employment Tax Calculator {year}",
  "quarterly-taxes": "Quarterly Estimated Tax Calculator {year}",
  "freelance-rate": "Freelance Rate Calculator",
  "contract-vs-salary": "1099 vs W-2 Calculator",
  "capital-gains": "Capital Gains Tax Calculator {year}",
  "compound-growth": "Compound Interest Calculator",
  "savings-bond": "I Bond Calculator",
  inflation: "Inflation Calculator (CPI)",
  "retirement-optimizer": "401(k) and IRA Contribution Calculator {year}",
  rmd: "RMD Calculator {year}",
  "social-security-tax": "Social Security Taxable Benefits Calculator",
  "medicare-irmaa": "Medicare IRMAA Calculator {year}",
  "loan-amortization": "Mortgage & Loan Amortization Calculator",
  "debt-freedom": "Debt Payoff Calculator",
  "student-loan-payment": "Student Loan Payment Calculator",
  "spending-plan": "50/30/20 Budget Calculator",
  "home-affordability": "Home Affordability Calculator",
  "life-insurance": "Life Insurance Needs Calculator",
  eitc: "EITC Calculator {year}",
  ctc: "Child Tax Credit Calculator {year}",
  "aca-ptc": "ACA Premium Tax Credit Calculator {year}",
  fpl: "Federal Poverty Level Calculator {year}",
  "fafsa-sai": "FAFSA Student Aid Index Calculator",
  "ui-estimator": "Unemployment Benefits Calculator",
  // Hubs, whose page lists the calculators it holds.
  "paycheck-taxes": "Paycheck & Tax Calculators {year}",
  "self-employed": "Self-Employed & 1099 Tax Calculators",
  benefits: "Benefits & Aid Eligibility Calculators",
  "when-money-is-tight": "Help When Money Is Tight",
  "where-you-stand": "Where You Stand: Financial Check-Up",
};

/** A title that already says what kind of tool it is needs no "Calculator". */
const NAMES_ITS_KIND =
  /\b(calculator|checker|estimator|estimate|planner|screener|checklist|chooser|explorer|optimizer|picker|timeline|sequences|limits|windows|triage)\b|\?$/i;

/** The searchable name a tile's page leads its `<title>` with. */
export function searchName(tile: TileDefinition, isHub: boolean): string {
  const named = SEARCH_NAMES[tile.id];
  if (named) return named.replace("{year}", String(TAX_YEAR));
  if (NAMES_ITS_KIND.test(tile.title)) return tile.title;
  return `${tile.title} ${isHub ? "Calculators" : "Calculator"}`;
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

/** The pages that point at the per-state pages (scripts/state-pages.ts). */
const BY_STATE = new Set(["take-home", "paycheck-taxes", "federal-income-tax", "w4"]);

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
  const name = searchName(tile, hubId === undefined);
  const title = `${name} · Free & private · enklayve`;
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
    <h1>${escapeHtml(name)}</h1>
    <p class="lede">${escapeHtml(tile.description)}</p>
${covers}    <a class="open" href="${appUrl}">Open the ${escapeHtml(tile.title)} tool →</a>
${BY_STATE.has(tile.id) ? `    <p><a href="/states">See take-home pay and income tax brackets for every state →</a></p>\n` : ""}${section("How this works", how)}${section(
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
