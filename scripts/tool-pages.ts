/**
 * Pre-rendered per-tile shells (BUILD-SPEC.md §11, Phase 11; the roughlogic
 * pattern). enklayve is a fragment-routed single page, so on its own no
 * individual tool has a crawlable URL. This emits one static, self-contained
 * HTML page per tile — `/tools/<id>.html` — carrying the tool's name, what it
 * does, how it works, and its trusted sources, with a prominent link into the
 * live on-device tool. Search engines get a real, indexable landing page for
 * every tool; people who land on one are one click from the app.
 *
 * Rendered here (not inline in the Vite plugin) so a test guards it against
 * registry drift. Styling is inline (the CSP allows 'unsafe-inline' for styles)
 * and nothing cross-origin is *loaded* — only the "learn more" anchors point
 * out, exactly as the live app does — so the privacy promise is intact.
 */
import { TILES } from "../src/tiles/registry";
import type { TileDefinition } from "../src/tiles/types";
import { escapeHtml } from "./tools-index";
import { SITE_ORIGIN } from "./sitemap";

/** The build path (and URL path, sans leading slash) for a tile's shell. */
export function toolPagePath(id: string): string {
  return `tools/${encodeURIComponent(id)}.html`;
}

const PAGE_STYLE = `
      :root { color-scheme: light dark; }
      body {
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        max-width: 44rem;
        margin: 0 auto;
        padding: 2rem 1.25rem;
        color: #1e1b2e;
        background: #faf8ff;
        line-height: 1.55;
      }
      nav a { font-weight: 700; }
      h1 { color: #6d28d9; margin-bottom: 0.25rem; }
      p.lede { color: #5b5570; margin-top: 0; font-size: 1.05rem; }
      h2 { color: #5b21b6; margin: 1.75rem 0 0.5rem; font-size: 1.1rem; }
      a { color: #6d28d9; font-weight: 600; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .open {
        display: inline-block;
        margin: 1.25rem 0 0.5rem;
        padding: 0.6rem 1.1rem;
        background: #6d28d9;
        color: #fff;
        border-radius: 8px;
      }
      .open:hover { background: #5b21b6; text-decoration: none; }
      .note { color: #5b5570; font-size: 0.85rem; margin-top: 2rem; }
      ul { padding-left: 1.1rem; }`;

/** Render the static landing page for one tile. */
export function renderToolPage(tile: TileDefinition): string {
  const appUrl = `/#/${encodeURIComponent(tile.id)}`;
  const canonical = `${SITE_ORIGIN}/${toolPagePath(tile.id)}`;

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

  const howSection = how ? `    <h2>How this works</h2>\n${how}\n` : "";
  const resourcesSection = resources
    ? `    <h2>Learn more</h2>\n    <ul>\n${resources}\n    </ul>\n`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(tile.title)} · enklayve</title>
    <meta name="description" content="${escapeHtml(tile.description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="index, follow" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="enklayve" />
    <meta property="og:title" content="${escapeHtml(tile.title)} · enklayve" />
    <meta property="og:description" content="${escapeHtml(tile.description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${SITE_ORIGIN}/icon.svg" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(tile.title)} · enklayve" />
    <meta name="twitter:description" content="${escapeHtml(tile.description)}" />
    <style>${PAGE_STYLE}
    </style>
  </head>
  <body>
    <nav><a href="/">← enklayve home</a> · <a href="/tools.html">All tools</a></nav>
    <h1>${escapeHtml(tile.title)}</h1>
    <p class="lede">${escapeHtml(tile.description)}</p>
    <a class="open" href="${appUrl}">Open the ${escapeHtml(tile.title)} tool →</a>
${howSection}${resourcesSection}    <p class="note">
      Computed entirely on your device for U.S. taxes and benefits. Nothing is ever sent
      anywhere, and it is free forever. Educational information, not financial, tax, investment,
      or legal advice.
    </p>
  </body>
</html>
`;
}

/** Every tile's shell, as build assets ({ fileName, source }). */
export function toolPages(): { fileName: string; source: string }[] {
  return TILES.map((t) => ({ fileName: toolPagePath(t.id), source: renderToolPage(t) }));
}
