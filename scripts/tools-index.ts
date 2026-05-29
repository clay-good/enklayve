/**
 * The pre-rendered All Tools index (BUILD-SPEC-2 §1.2). A static, self-contained,
 * crawlable HTML page with a real anchor per tool, so every tool has a stable,
 * linkable, indexable home even though the app itself is a fragment-routed single
 * page. Emitted into the build by the Vite plugin in vite.config.ts; rendered
 * here (not inline) so a test can guard it against registry drift. Styling is
 * inline — the CSP allows 'unsafe-inline' for styles — so the file depends on no
 * hashed asset names.
 */
import { tilesForPillar } from "../src/tiles/registry";
import { PILLARS } from "../src/tiles/types";

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
  const groups = PILLARS.map((pillar) => {
    const items = tilesForPillar(pillar.id)
      .map(
        (t) =>
          `        <li><a href="/#/${encodeURIComponent(t.id)}">${escapeHtml(t.title)}</a>` +
          `<span class="d"> — ${escapeHtml(t.description)}</span></li>`,
      )
      .join("\n");
    return (
      `      <section>\n` +
      `        <h2>${escapeHtml(pillar.title)}</h2>\n` +
      `        <ul>\n${items}\n        </ul>\n` +
      `      </section>`
    );
  }).join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>All tools — enklayve</title>
    <meta
      name="description"
      content="The full index of enklayve tools. Every figure is computed on your device; nothing is ever sent anywhere."
    />
    <link rel="canonical" href="/tools.html" />
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
      h2 { color: #5b21b6; margin: 1.75rem 0 0.5rem; font-size: 1.15rem; }
      p.lede { color: #5b5570; margin-top: 0; }
      ul { list-style: none; padding: 0; margin: 0; }
      li { padding: 0.3rem 0; }
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
      Every enklayve tool, grouped by pillar. Each one runs entirely on your device —
      nothing is ever sent anywhere.
    </p>
    <main>
${groups}
    </main>
  </body>
</html>
`;
}
