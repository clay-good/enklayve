/**
 * Generates the social-card image (`public/og-image.png`, 1200x630) referenced
 * by the `og:image` / `twitter:image` meta tags on the home, the All Tools
 * index, and every per-tool shell.
 *
 * Why a raster, not the SVG icon: SVG `og:image`s do not render on Twitter/X,
 * Facebook, LinkedIn, Slack, or iMessage, so a vector card means *no* preview
 * image anywhere the site is shared. This renders an on-brand card with the
 * royal-purple design tokens and screenshots it to a PNG.
 *
 * It's a one-off brand asset, committed like `icon.svg` — not a build step, so
 * CI never runs Playwright for it. Regenerate with `npm run og:image` after a
 * brand or copy change. The card uses only system fonts (no network), matching
 * the privacy promise even at generation time.
 */
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const WIDTH = 1200;
const HEIGHT = 630;

/** The branded card. System fonts only; royal-purple tokens from styles.css. */
const CARD_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; box-sizing: border-box; }
      html, body { width: ${WIDTH}px; height: ${HEIGHT}px; }
      body {
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        background: radial-gradient(1200px 700px at 78% -12%, #7c3aed 0%, #6d28d9 42%, #4c1d95 100%);
        color: #fff;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 84px 88px;
        position: relative;
        overflow: hidden;
      }
      .wordmark {
        font-size: 86px;
        font-weight: 800;
        letter-spacing: -0.03em;
        line-height: 1;
      }
      .tagline {
        margin-top: 10px;
        font-size: 30px;
        font-weight: 500;
        color: #d6c9f7;
        text-transform: lowercase;
      }
      .headline {
        margin-top: 52px;
        font-size: 56px;
        font-weight: 750;
        letter-spacing: -0.02em;
        line-height: 1.08;
        max-width: 980px;
      }
      .headline .accent { color: #fbbf24; }
      .sub {
        margin-top: 26px;
        font-size: 29px;
        line-height: 1.4;
        color: #e7defb;
        max-width: 960px;
      }
      .trust {
        position: absolute;
        left: 88px;
        bottom: 64px;
        font-size: 25px;
        font-weight: 600;
        color: #cdbcf3;
        display: flex;
        gap: 18px;
        align-items: center;
      }
      .dot { width: 7px; height: 7px; border-radius: 50%; background: #fbbf24; }
    </style>
  </head>
  <body>
    <div class="wordmark">enklayve</div>
    <div class="tagline">personal finance</div>
    <div class="headline">Know where you stand. <span class="accent">Privately.</span></div>
    <div class="sub">
      Your real take-home, the taxes you owe, and the benefits you're owed —
      computed on your device. Free, forever.
    </div>
    <div class="trust">
      <span>enklayve.com</span><span class="dot"></span><span>no accounts</span>
      <span class="dot"></span><span>no ads</span><span class="dot"></span><span>shows its math</span>
    </div>
  </body>
</html>`;

async function main(): Promise<void> {
  const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "og-image.png");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    await page.setContent(CARD_HTML, { waitUntil: "networkidle" });
    await page.screenshot({ path: out, type: "png" });
    console.log(`Wrote ${out} (${WIDTH}x${HEIGHT})`);
  } finally {
    await browser.close();
  }
}

void main();
