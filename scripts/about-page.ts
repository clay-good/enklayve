/**
 * The static "Why enklayve" page (`/about.html`).
 *
 * The argument for the site — free forever, computed on your device, shows its
 * work — lived only at the fragment route `#/about`, and a fragment is not a URL
 * a search engine can index. So the page that answers "is this free?", "where
 * does my data go?" and "what is actually in here?" had no indexable home at
 * all, while sixty-nine calculators each had one.
 *
 * The copy comes from src/ui/aboutCopy.ts, the same strings the in-app view
 * renders, and the areas come from the registry — so this page cannot drift
 * from either. Styling is inline (the CSP allows 'unsafe-inline' for styles)
 * and nothing cross-origin is loaded; the "trusted resources" anchors point out,
 * exactly as the live app's do.
 */
import { TILES, SUB_TOOLS } from "../src/tiles/registry";
import { ABOUT_LEDE, ABOUT_POINTS, WHERE_IT_WORKS, US_RESOURCES } from "../src/ui/aboutCopy";
import { CATALOG_SUMMARY } from "../src/ui/seo";
import { escapeHtml, PAGE_STYLE, breadcrumb, TOOL_COUNT, HUB_COUNT } from "./tools-index";
import { toolPagePath } from "./tool-pages";
import { SITE_ORIGIN } from "./sitemap";

/** The build path (and URL path, sans leading slash) for this page. */
export const ABOUT_PAGE_PATH = "about.html";

export const ABOUT_TITLE = "Why enklayve · Free, private personal finance tools";
export const ABOUT_DESCRIPTION =
  `Why enklayve is free forever, why nothing you type ever leaves your device, and what the ` +
  `${TOOL_COUNT} calculators cover. No account, no ads, no tracking, and every number links the ` +
  "public rule behind it.";

const EXTRA_STYLE = `
      .points { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1rem; }
      .point { border: 1px solid #e6e0f5; border-radius: 10px; padding: 1rem 1.1rem; }
      .point h3 { margin: 0 0 0.25rem; font-size: 1rem; }
      .point p { margin: 0; color: #5b5570; }`;

/** Render the static "Why enklayve" document. */
export function renderAboutPage(): string {
  const canonical = `${SITE_ORIGIN}/${ABOUT_PAGE_PATH}`;

  const points = ABOUT_POINTS.map(
    (p) =>
      `        <div class="point"><h3>${escapeHtml(p.title)}</h3>` +
      `<p>${escapeHtml(p.body)}</p></div>`,
  ).join("\n");

  const areas = TILES.map((hub) => {
    const count = SUB_TOOLS.filter((s) => s.hubId === hub.id).length;
    return (
      `        <li><a href="/${toolPagePath(hub.id)}">${escapeHtml(hub.title)}</a> ` +
      `<span class="d">(${count}), ${escapeHtml(hub.description)}</span></li>`
    );
  }).join("\n");

  const resources = US_RESOURCES.map(
    (r) =>
      `        <li><a href="${escapeHtml(r.url)}" rel="noopener noreferrer">${escapeHtml(r.label)}</a></li>`,
  ).join("\n");

  // An AboutPage that states the price plainly, so "is it free?" is answerable
  // from the structured data rather than only from the prose.
  const about = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: ABOUT_TITLE,
    url: canonical,
    description: ABOUT_DESCRIPTION,
    mainEntity: {
      "@type": "WebApplication",
      name: "enklayve",
      url: `${SITE_ORIGIN}/`,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Any (web browser)",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      featureList: TILES.map((t) => t.title),
    },
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escapeHtml(ABOUT_TITLE)}</title>
    <meta name="description" content="${escapeHtml(ABOUT_DESCRIPTION)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="index, follow" />
    <meta name="theme-color" content="#6D28D9" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="enklayve" />
    <meta property="og:title" content="${escapeHtml(ABOUT_TITLE)}" />
    <meta property="og:description" content="${escapeHtml(ABOUT_DESCRIPTION)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${SITE_ORIGIN}/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(ABOUT_TITLE)}" />
    <meta name="twitter:description" content="${escapeHtml(ABOUT_DESCRIPTION)}" />
    <meta name="twitter:image" content="${SITE_ORIGIN}/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(about)}</script>
    <script type="application/ld+json">${breadcrumb([
      { name: "enklayve", url: `${SITE_ORIGIN}/` },
      { name: "Why enklayve", url: canonical },
    ])}</script>
    <style>${PAGE_STYLE}${EXTRA_STYLE}
    </style>
  </head>
  <body>
    <nav><a href="/">← enklayve home</a> · <a href="/tools.html">All tools</a></nav>
    <h1>Why enklayve</h1>
    <p class="lede">${escapeHtml(ABOUT_LEDE)}</p>
    <h2>What makes it different</h2>
    <div class="points">
${points}
    </div>
    <h2>What is inside: ${TOOL_COUNT} calculators, in ${HUB_COUNT} areas</h2>
    <p>${escapeHtml(CATALOG_SUMMARY)}</p>
    <ul class="tools">
${areas}
    </ul>
    <p><a href="/tools.html">See all ${TOOL_COUNT} calculators →</a></p>
    <h2>Where it works</h2>
    <p>${escapeHtml(WHERE_IT_WORKS)}</p>
    <h2>Trusted resources</h2>
    <ul class="tools">
${resources}
    </ul>
    <p class="note">
      Free forever, with no account and no ads. Computed entirely on your device for U.S. taxes
      and benefits — nothing is ever sent anywhere. Educational information, not financial, tax,
      investment, or legal advice.
    </p>
  </body>
</html>
`;
}
