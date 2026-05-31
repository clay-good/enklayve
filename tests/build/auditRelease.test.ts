import { describe, it, expect } from "vitest";
import {
  checkCsp,
  checkIndexHtml,
  checkProvenance,
  checkLocalStorage,
} from "../../scripts/audit-release";

/**
 * The release audit gate (BUILD-SPEC.md §10). The checks are pure functions of
 * file contents; here we prove each one passes on good input and flags the
 * matching violation, so the gate genuinely protects the family invariants.
 */
describe("audit: CSP connect-src 'none'", () => {
  it("passes when the page CSP locks connect-src to none", () => {
    expect(checkCsp("...\"connect-src 'none'\"...")).toEqual([]);
  });
  it("flags a relaxed connect-src", () => {
    expect(checkCsp("\"connect-src 'self'\"").length).toBe(1);
  });
});

describe("audit: no cross-origin resource loads in index.html", () => {
  it("passes for relative/same-origin assets", () => {
    const html =
      '<script type="module" src="/assets/index-abc.js"></script><link rel="manifest" href="/manifest.webmanifest" />';
    expect(checkIndexHtml(html)).toEqual([]);
  });
  it("flags a cross-origin script or stylesheet", () => {
    const html = '<script src="https://cdn.example.com/x.js"></script>';
    expect(checkIndexHtml(html).length).toBe(1);
  });
  it("allows a self-referential absolute canonical/og URL on the production origin", () => {
    const html =
      '<link rel="canonical" href="https://enklayve.com/" />' +
      '<meta property="og:url" content="https://enklayve.com/" />' +
      '<meta property="og:image" content="https://enklayve.com/icon.svg" />';
    expect(checkIndexHtml(html)).toEqual([]);
  });
  it("still flags a look-alike origin that only starts with the production host", () => {
    const html = '<link rel="preload" href="https://enklayve.com.evil.example/x.js" />';
    expect(checkIndexHtml(html).length).toBe(1);
  });
});

describe("audit: dataset provenance", () => {
  const cited = { citation: { sourceUrl: "https://irs.gov", sourceDocument: "IRS X" } };
  it("passes when every shard carries a complete citation", () => {
    expect(checkProvenance([{ name: "a.json", json: cited }])).toEqual([]);
  });
  it("flags a shard missing its citation", () => {
    expect(
      checkProvenance([{ name: "bad.json", json: { citation: { sourceUrl: "" } } }]).length,
    ).toBe(1);
    expect(checkProvenance([{ name: "none.json", json: {} }]).length).toBe(1);
  });
});

describe("audit: localStorage boundary", () => {
  it("allows localStorage only in ui/theme.ts", () => {
    expect(
      checkLocalStorage([{ path: "src/ui/theme.ts", content: "localStorage.setItem(k, v)" }]),
    ).toEqual([]);
  });
  it("flags localStorage anywhere financial", () => {
    expect(
      checkLocalStorage([
        { path: "src/tiles/takeHome.ts", content: "localStorage.setItem('income', x)" },
      ]).length,
    ).toBe(1);
  });
});
