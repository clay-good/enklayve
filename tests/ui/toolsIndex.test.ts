import { describe, it, expect } from "vitest";
import { renderToolsIndex, escapeHtml } from "../../scripts/tools-index";
import { TILES } from "../../src/tiles/registry";

/**
 * The pre-rendered All Tools index (BUILD-SPEC-2 §1.2, Phase 13) must stay in
 * lockstep with the registry: every tool needs a stable, linkable, crawlable
 * home. This guards the static tools.html against drift.
 */
describe("static All Tools index", () => {
  const html = renderToolsIndex();

  it("emits a real, linkable anchor for every registered tile", () => {
    for (const tile of TILES) {
      expect(html).toContain(`href="/#/${tile.id}"`);
      expect(html).toContain(`>${escapeHtml(tile.title)}</a>`);
    }
  });

  it("links exactly as many tools as the registry holds", () => {
    const links = html.match(/href="\/#\//g) ?? [];
    expect(links.length).toBe(TILES.length);
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
