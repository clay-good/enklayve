/**
 * Sitemap and robots.txt (BUILD-SPEC.md §11, Phase 11). enklayve is a single
 * fragment-routed page, so the only URLs a crawler can index are the real,
 * pre-rendered static files: the home, the All Tools index, and one shell per
 * tool (scripts/tool-pages.ts). The sitemap lists exactly those, and robots.txt
 * points at it. Rendered here (not inline in the Vite plugin) so a test can
 * guard them against registry drift.
 */

/** The canonical production origin. enklayve deploys to enklayve.com. */
export const SITE_ORIGIN = "https://enklayve.com";

/** Render a sitemap listing the given absolute paths (each beginning with "/"). */
export function renderSitemap(origin: string, paths: string[]): string {
  const urls = paths.map((p) => `  <url>\n    <loc>${origin}${p}</loc>\n  </url>`).join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${urls}\n` +
    `</urlset>\n`
  );
}

/** Render robots.txt: allow everything (there is nothing to hide) and advertise
 * the sitemap. Nothing here is a tracker — it is the standard discovery file. */
export function renderRobots(origin: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
}
