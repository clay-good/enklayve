import { describe, it, expect } from "vitest";
import {
  checkCsp,
  checkIndexHtml,
  checkProvenance,
  checkCitationLength,
  SOURCE_DOCUMENT_MAX,
  checkLocalStorage,
  checkHarmTier,
  type AuditTile,
} from "../../scripts/audit-release";
import { TILES, SUB_TOOLS } from "../../src/tiles/registry";

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

describe("audit: citation sourceDocument length cap", () => {
  it("passes for a short citation-style name", () => {
    const json = { citation: { sourceDocument: "IRS Rev. Proc. 2024-40 (2026 adjustments)" } };
    expect(checkCitationLength([{ name: "ok.json", json }])).toEqual([]);
  });
  it("flags a sourceDocument that smuggles prose past the cap", () => {
    const json = { citation: { sourceDocument: "x".repeat(SOURCE_DOCUMENT_MAX + 1) } };
    expect(checkCitationLength([{ name: "long.json", json }]).length).toBe(1);
  });
  it("ignores a shard with no citation (the provenance check owns that case)", () => {
    expect(checkCitationLength([{ name: "none.json", json: {} }])).toEqual([]);
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

/**
 * The Pillar 4 admission bar (SPEC-4 §3.2, §7.2). This runs from the test suite
 * rather than the audit CLI — the CLI executes under plain `node`, which cannot
 * resolve the extensionless TypeScript module graph the registry is built from.
 * CI runs `npm run test`, so the gate is no weaker for living here.
 */
const ADVICE = "This is information about published rules, not legal advice.";

describe("audit: Pillar 4 harm tiers", () => {
  it("ignores tiles outside the rough pillar", () => {
    expect(checkHarmTier([{ id: "take-home", pillar: "paycheck" }])).toEqual([]);
  });

  it("flags a rough tile that declares no harm tier", () => {
    const violations = checkHarmTier([{ id: "cliff-explorer", pillar: "rough" }]);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("declares no harmTier");
  });

  it("passes a tier-1 informational tile with no channels or advice line", () => {
    expect(checkHarmTier([{ id: "cliff-explorer", pillar: "rough", harmTier: 1 }])).toEqual([]);
  });

  it("flags a tier-3 screener that names no channel to act through", () => {
    const violations = checkHarmTier([
      { id: "garnishment", pillar: "rough", harmTier: 3, channels: [], how: ADVICE },
    ]);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("names no channels");
  });

  it("flags a tier-2 tile whose how block omits the advice line", () => {
    const violations = checkHarmTier([
      { id: "bill-triage", pillar: "rough", harmTier: 2, how: "Sorts your bills by consequence." },
    ]);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("omits the advice line");
  });

  it("passes a fully-configured tier-3 tile", () => {
    expect(
      checkHarmTier([
        {
          id: "garnishment",
          pillar: "rough",
          harmTier: 3,
          channels: [{ label: "Legal aid", url: "https://www.lsc.gov/" }],
          how: ADVICE,
        },
      ]),
    ).toEqual([]);
  });

  it("holds over the real catalog, hubs and sub-tools alike", () => {
    const tiles: AuditTile[] = [...TILES, ...SUB_TOOLS.map((s) => s.tile)];
    expect(checkHarmTier(tiles)).toEqual([]);
  });
});
