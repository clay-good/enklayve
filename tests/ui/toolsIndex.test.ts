import { describe, it, expect } from "vitest";
import { renderToolsIndex, escapeHtml } from "../../scripts/tools-index";
import { TILES, SUB_TOOLS } from "../../src/tiles/registry";

/**
 * The pre-rendered All Tools index (BUILD-SPEC-2 §1.2, Phase 13) must stay in
 * lockstep with the registry: every tool needs a stable, linkable, crawlable
 * home. This guards the static tools.html against drift.
 */
describe("static All Tools index", () => {
  const html = renderToolsIndex();

  it("emits a real, linkable anchor into the live app for every hub", () => {
    for (const tile of TILES) {
      expect(html).toContain(`href="/#/${tile.id}"`);
      expect(html).toContain(`>${escapeHtml(tile.title)}</a>`);
    }
  });

  it("links every hub into the live app, exactly once", () => {
    const links = html.match(/href="\/#\//g) ?? [];
    expect(links.length).toBe(TILES.length);
  });

  it("names every calculator and links its crawlable landing page", () => {
    for (const { tile } of SUB_TOOLS) {
      expect(html).toContain(`href="/tools/${tile.id}.html"`);
      expect(html).toContain(`>${escapeHtml(tile.title)}</a>`);
    }
    // One sub-tool landing-page link per hosted calculator.
    const subLinks = html.match(/href="\/tools\/[^"]+\.html"/g) ?? [];
    expect(subLinks.length).toBe(SUB_TOOLS.length);
  });

  it("is a complete, crawlable HTML document with a link home", () => {
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>All tools · enklayve</title>");
    expect(html).toContain('<a href="/">');
  });

  it("escapes interpolated text", () => {
    expect(escapeHtml('a & b < c > d "e"')).toBe("a &amp; b &lt; c &gt; d &quot;e&quot;");
  });
});
