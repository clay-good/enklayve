import { describe, it, expect } from "vitest";
import { renderToolsIndex, escapeHtml, TOOL_COUNT, HUB_COUNT } from "../../scripts/tools-index";
import { TILES, SUB_TOOLS } from "../../src/tiles/registry";

/**
 * The pre-rendered All Tools index (BUILD-SPEC-2 §1.2, Phase 13) must stay in
 * lockstep with the registry: every tool needs a stable, linkable, crawlable
 * home. This guards the static tools.html against drift.
 */
describe("static All Tools index", () => {
  const html = renderToolsIndex();

  it("heads each hub with its own crawlable page, and links the live app beside it", () => {
    for (const tile of TILES) {
      // The heading is a real URL a search engine can rank, not a fragment it
      // cannot; the "Open" link beside it is for a reader who wants the tool.
      expect(html).toContain(`href="/tools/${tile.id}.html"`);
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
    // One landing-page link per calculator, plus one per hub heading.
    const subLinks = html.match(/href="\/tools\/[^"]+\.html"/g) ?? [];
    expect(subLinks.length).toBe(SUB_TOOLS.length + TILES.length);
  });

  /**
   * This is the page a search for "free personal finance calculators" should be
   * able to land on, so the two things it is ranked on — the title and the
   * heading — have to say the count and the word "free", and say them from the
   * registry rather than from memory.
   */
  it("states the catalog's size in its title and heading, from the registry", () => {
    expect(TOOL_COUNT).toBe(SUB_TOOLS.length);
    expect(HUB_COUNT).toBe(TILES.length);
    expect(html).toContain(`<title>All ${TOOL_COUNT} free personal finance calculators`);
    expect(html).toContain(`<h1>All ${TOOL_COUNT} free calculators</h1>`);
  });

  it("carries an ItemList of every calculator, and a breadcrumb, that parse", () => {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(blocks.length).toBe(2);
    const [list, crumbs] = blocks.map((m) => JSON.parse(m[1]!));
    expect(list["@type"]).toBe("ItemList");
    expect(list.itemListElement.length).toBe(SUB_TOOLS.length);
    expect(crumbs["@type"]).toBe("BreadcrumbList");
  });

  it("is a complete, crawlable HTML document with a link home", () => {
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<a href="/">');
    // Readable on a phone without a pinch: one column, real viewport.
    expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1');
  });

  it("escapes interpolated text", () => {
    expect(escapeHtml('a & b < c > d "e"')).toBe("a &amp; b &lt; c &gt; d &quot;e&quot;");
  });
});

/**
 * Every "Related tools" link is a `hubId` plus a `tool` id that the router
 * turns into `?tool=<id>` inside that hub. Neither half is checked by the type
 * system, so a tool that is renamed — or referenced by the name a reader would
 * guess rather than the one it has — produces a button that navigates to a hub
 * and silently lands on its default calculator instead. Two shipped links were
 * doing exactly that (`benefits/owed-screener`, whose real id is `screener`)
 * before this test existed.
 */
describe("cross-tool related links resolve", () => {
  const hubs = new Map<string, Set<string>>();
  for (const { tile, hubId } of SUB_TOOLS) {
    if (!hubs.has(hubId)) hubs.set(hubId, new Set());
    hubs.get(hubId)!.add(tile.id);
  }

  it("names a hub that exists and a tool inside it", () => {
    const broken: string[] = [];
    for (const { tile } of SUB_TOOLS) {
      for (const r of tile.related ?? []) {
        const tools = hubs.get(r.hubId);
        if (!tools) broken.push(`${tile.id} -> unknown hub "${r.hubId}"`);
        else if (r.tool && !tools.has(r.tool)) {
          broken.push(`${tile.id} -> "${r.hubId}" has no tool "${r.tool}"`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
