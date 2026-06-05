/**
 * The pre-rendered All Tools index (BUILD-SPEC-2 §1.2). A static, self-contained,
 * crawlable HTML page with a real anchor per tool, so every tool has a stable,
 * linkable, indexable home even though the app itself is a fragment-routed single
 * page. Emitted into the build by the Vite plugin in vite.config.ts; rendered
 * here (not inline) so a test can guard it against registry drift. Styling is
 * inline — the CSP allows 'unsafe-inline' for styles — so the file depends on no
 * hashed asset names.
 */
import { TILES, SUB_TOOLS } from "../src/tiles/registry";
import { SITE_ORIGIN } from "./sitemap";

/** Escape text for safe interpolation into HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render the full static All Tools index document. */
export function renderToolsIndex(): string {
  // One section per topic hub. The hub heading links into the live app; each
  // calculator it hosts links to its own pre-rendered, crawlable landing page
  // (which in turn deep-links into the hub), so every calculator is named here
  // and every per-tool page is reachable in one hop from the index, not only
  // via the sitemap.
  const groups = TILES.map((hub) => {
    const subs = SUB_TOOLS.filter((s) => s.hubId === hub.id).map((s) => s.tile);
    const items = subs
      .map(
        (t) =>
          `        <li><a href="/tools/${encodeURIComponent(t.id)}.html">${escapeHtml(t.title)}</a>` +
          `<span class="d">, ${escapeHtml(t.description)}</span></li>`,
      )
      .join("\n");
    return (
      `      <section>\n` +
      `        <h2><a href="/#/${encodeURIComponent(hub.id)}">${escapeHtml(hub.title)}</a></h2>\n` +
      `        <p class="hubdesc">${escapeHtml(hub.description)}</p>\n` +
      `        <ul>\n${items}\n        </ul>\n` +
      `      </section>`
    );
  }).join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>All tools · enklayve</title>
    <meta
      name="description"
      content="The full index of enklayve tools. Every figure is computed on your device; nothing is ever sent anywhere."
    />
    <link rel="canonical" href="${SITE_ORIGIN}/tools.html" />
    <meta name="robots" content="index, follow" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="enklayve" />
    <meta property="og:title" content="All tools · enklayve" />
    <meta
      property="og:description"
      content="The full index of enklayve tools. Every figure is computed on your device; nothing is ever sent anywhere."
    />
    <meta property="og:url" content="${SITE_ORIGIN}/tools.html" />
    <meta property="og:image" content="${SITE_ORIGIN}/icon.svg" />
    <meta name="twitter:card" content="summary" />
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        max-width: 48rem;
        margin: 0 auto;
        padding: 2rem 1.25rem;
        color: #1e1b2e;
        background: #faf8ff;
        line-height: 1.5;
      }
      h1 { color: #6d28d9; margin-bottom: 0.25rem; }
      h2 { color: #5b21b6; margin: 1.75rem 0 0.15rem; font-size: 1.15rem; }
      h2 a { color: #5b21b6; }
      p.lede { color: #5b5570; margin-top: 0; }
      p.hubdesc { color: #5b5570; margin: 0 0 0.5rem; font-size: 0.95rem; }
      ul { list-style: none; padding: 0; margin: 0; }
      li { padding: 0.25rem 0; }
      a { color: #6d28d9; font-weight: 600; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .d { color: #5b5570; font-weight: 400; }
      nav a { font-weight: 700; }
    </style>
  </head>
  <body>
    <nav><a href="/">← enklayve home</a></nav>
    <h1>All tools</h1>
    <p class="lede">
      Every enklayve calculator, grouped by topic. Each one runs entirely on your device,
      nothing is ever sent anywhere.
    </p>
    <main>
${groups}
    </main>
  </body>
</html>
`;
}
