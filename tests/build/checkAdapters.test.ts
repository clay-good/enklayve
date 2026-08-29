import { describe, it, expect } from "vitest";
import {
  classifyAnchor,
  renderAnchorReport,
  type AnchorResult,
} from "../../scripts/check-adapters";
import { ADAPTERS } from "../../scripts/refresh/adapters";
import { extractUrls, sourceFiles } from "../../scripts/check-links";
import { isPdf } from "../../scripts/fetch-source";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The adapter-anchoring check.
 *
 * A refresh adapter is only doing its job while the page it points at still
 * *states* the figure it anchors. When an agency moves a number into a PDF or
 * behind client-side rendering, the adapter stops parsing — which opens a
 * fail-safe alert PR rather than shipping bad data, correctly — but the shard
 * then quietly stops being watched and sits at whatever year it was authored
 * in, still carrying a live and apparently valid .gov citation.
 *
 * That is not hypothetical: the 2026-08-29 source audit found Illinois,
 * Michigan, Missouri and Georgia a year or two stale for exactly this reason.
 * These tests cover the pure classification and reporting; the fetch itself
 * runs on a schedule, never here.
 */
const ROOT = resolve(__dirname, "..", "..");

function result(over: Partial<AnchorResult>): AnchorResult {
  return {
    adapterId: "state-xx-income-tax-2024",
    group: "state-xx",
    url: "https://example.test/rates",
    status: "anchored",
    ...over,
  };
}

describe("classifying one adapter's outcome", () => {
  it("separates a page that never arrived from one the parser could not read", () => {
    // Unreachable is the agency's problem and may be transient; unparsed is
    // ours and means a shard has stopped being watched. Conflating them would
    // bury the actionable case under the noisy one.
    expect(classifyAnchor({ ok: false, reason: "HTTP 503" }, () => ({ ok: true }))).toEqual({
      status: "unreachable",
      detail: "HTTP 503",
    });
    expect(
      classifyAnchor({ ok: true, raw: "<html>nothing useful</html>" }, () => ({
        ok: false,
        reason: "could not anchor the flat income-tax rate",
      })),
    ).toEqual({ status: "unparsed", detail: "could not anchor the flat income-tax rate" });
  });

  it("does not run the parser at all when the fetch failed", () => {
    let ran = false;
    classifyAnchor({ ok: false, reason: "timeout" }, () => {
      ran = true;
      return { ok: true };
    });
    expect(ran).toBe(false);
  });

  it("anchors when the parser finds its figure, and reports no detail", () => {
    expect(classifyAnchor({ ok: true, raw: "rate is 4.95%" }, () => ({ ok: true }))).toEqual({
      status: "anchored",
    });
  });
});

describe("the report", () => {
  it("counts every status and names each adapter that cannot anchor", () => {
    const report = renderAnchorReport([
      result({ adapterId: "a", status: "anchored" }),
      result({ adapterId: "b", status: "unparsed", detail: "could not anchor the rate" }),
      result({ adapterId: "c", status: "unreachable", detail: "HTTP 404" }),
    ]);
    expect(report).toMatch(/Checked 3 refresh adapters/);
    // The report must never let a green line read as a data guarantee. Pointing
    // Maine's deduction adapter at a form that does state the deduction made it
    // "anchor" a bracket threshold and the personal exemption instead.
    expect(report).toMatch(/not that the value is right/);
    expect(report).toMatch(/1 anchored · 1 could not parse · 1 unreachable/);
    expect(report).toMatch(/## Could not anchor/);
    expect(report).toMatch(/could not anchor the rate/);
    expect(report).toMatch(/## Unreachable/);
    expect(report).toMatch(/HTTP 404/);
  });

  it("omits a section entirely when nothing is in it", () => {
    // An all-green report should be two lines, not two empty headings inviting
    // a reader to scan for problems that are not there.
    const report = renderAnchorReport([result({}), result({ adapterId: "b" })]);
    expect(report).not.toMatch(/## /);
    expect(report).toMatch(/2 anchored · 0 could not parse · 0 unreachable/);
  });
});

describe("what the check can be run against", () => {
  it("every adapter names a shard that exists, so the check can never skip one", () => {
    // The check reads each adapter's committed shard to parse onto. An adapter
    // whose id does not match a file would throw mid-run and take the whole
    // report with it.
    for (const adapter of ADAPTERS) {
      const path = resolve(ROOT, "data", `${adapter.id}.json`);
      expect(existsSync(path), `${adapter.id} has no shard`).toBe(true);
      expect(() => JSON.parse(readFileSync(path, "utf8"))).not.toThrow();
    }
  });

  it("every adapter's source URL is one the link check also sweeps", () => {
    // An adapter names the page it watches, and for most of them that URL lives
    // only in scripts/refresh/adapters.ts. If the link check does not sweep that
    // file, an adapter can point at a 404 for a year with nothing to notice —
    // which is what had happened to California's, North Carolina's, Utah's and
    // Ohio's. This is the invariant that keeps the two checks joined up.
    const seen = new Set<string>();
    for (const file of sourceFiles()) {
      for (const url of extractUrls(readFileSync(file, "utf8"))) seen.add(url);
    }
    const invisible = ADAPTERS.filter((a) => !seen.has(a.sourceUrl)).map((a) => a.id);
    expect(invisible).toEqual([]);
  });
});

describe("reading a source that is a PDF", () => {
  it("recognises a PDF by content type or by path, and markup as neither", () => {
    // Agencies keep moving figures off HTML pages and into a form or bulletin.
    // While the pipeline could only read markup, every one of those shards was
    // unwatched — which is how four of them went a year or two stale behind
    // live, correct-looking citations.
    expect(isPdf("https://x.test/a", "application/pdf")).toBe(true);
    expect(isPdf("https://x.test/a", "application/pdf; charset=binary")).toBe(true);
    // Some servers send octet-stream for a .pdf path, so the path decides too.
    expect(isPdf("https://x.test/facts-2026.pdf", "application/octet-stream")).toBe(true);
    expect(isPdf("https://x.test/facts-2026.PDF?v=2", null)).toBe(true);
    expect(isPdf("https://x.test/rates.html", "text/html")).toBe(false);
    // A path that merely mentions pdf is not one.
    expect(isPdf("https://x.test/pdf-guide", "text/html")).toBe(false);
  });
});
