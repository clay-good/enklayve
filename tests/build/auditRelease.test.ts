import { describe, it, expect } from "vitest";
import {
  checkBuildIsCurrent,
  checkCsp,
  checkIndexHtml,
  checkProvenance,
  checkCitationLength,
  SOURCE_DOCUMENT_MAX,
  checkLocalStorage,
  checkHarmTier,
  type AuditTile,
  checkBundleBudget,
  checkPrecacheContents,
  shellBreakdown,
  sourceNoteBytes,
  shellSummary,
  SHELL_GZIP_BUDGET_KB,
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

/**
 * A structural invariant of the catalog, not a release-audit check: a tile that
 * says it is "ready" but carries no `mount` renders an empty panel inside its
 * hub — silently, with no error, and invisibly to any test that calls the mount
 * function directly. This asserts the wiring the shell actually relies on.
 */
describe("registry: every ready tile is actually mountable", () => {
  it("holds for hubs and sub-tools alike", () => {
    const unmountable = [...TILES, ...SUB_TOOLS.map((s) => s.tile)]
      .filter((t) => t.status === "ready" && typeof t.mount !== "function")
      .map((t) => t.id);
    expect(unmountable).toEqual([]);
  });
});

/**
 * The shell's byte budget (audit check 7).
 *
 * This is the one size figure that describes what a reader pays: the bytes
 * downloaded before anything works, and the bytes the service worker must hold
 * to run offline. It had been drifting unwatched — the README claimed "~180 kB
 * gzipped" against a real 241 — while Vite's own chunk warning tripped on every
 * build until it became scenery. A warning that always fires is not a warning,
 * so this is a gate.
 */
describe("what the audit says when the budget passes", () => {
  const kb = (n: number) => n * 1024;

  it("reports the shell, its budget, and what is left", () => {
    // The headroom here is a few kilobytes on purpose. A gate that speaks only
    // when it fails means the first time anyone learns how close it was is the
    // build that broke — which is how the README came to claim 180 kB against a
    // real 241.
    const line = shellSummary(
      [
        { path: "/assets/index-abc.js", gzipBytes: kb(240) },
        { path: "/index.html", gzipBytes: kb(2) },
      ],
      265,
    );
    expect(line).toContain("242.0 of 265 kB gzipped");
    expect(line).toContain("23.0 kB free");
    expect(line).toContain("2 assets");
    // Naming the biggest one is what turns the number into somewhere to look.
    expect(line).toContain("/assets/index-abc.js");
  });

  it("says a negative headroom rather than hiding it behind a zero", () => {
    const line = shellSummary([{ path: "/a.js", gzipBytes: kb(300) }], 265);
    expect(line).toContain("-35.0 kB free");
  });

  it("does not fall over on an empty precache list", () => {
    expect(() => shellSummary([], SHELL_GZIP_BUDGET_KB)).not.toThrow();
  });
});

describe("where the shell's bytes come from", () => {
  it("ranks the contributors and names a dependency by package", () => {
    const lines = shellBreakdown(
      [
        "../../src/tiles/takeHome.ts",
        "../../src/tiles/eitc.ts",
        "../../node_modules/zod/v3/types.js",
        "../../node_modules/decimal.js/decimal.mjs",
        "../../data/federal-income-tax-2024.json",
        "../../src/engine/money.ts",
        "../../src/data/schemas.ts",
      ],
      [30_000, 20_000, 40_000, 10_000, 5_000, 1_000, 9_000],
    );
    // Ranked, so the answer to "what is in there" is the first line — and
    // src/tiles is the two tile files summed, not either one alone, which is
    // what puts it above the single largest file.
    expect(lines[0]).toContain("src/tiles");
    expect(lines[0]).toContain("48.8 kB");
    expect(lines[1]).toContain("node_modules/zod/v3");
    expect(lines.some((l) => l.includes("node_modules/decimal.js"))).toBe(true);
    // Only the inlined JSON is "shards". Grouping on a "/data/" path instead
    // filed all of `src/data` — the loader, the schemas, the integrity gate —
    // under shards, which is how the first run of this reported no `src/data`
    // line at all and a data figure a third too large.
    expect(lines.some((l) => l.includes("4.9 kB  data/ (bundled shards)"))).toBe(true);
    expect(lines.some((l) => l.includes("src/data"))).toBe(true);
  });

  it("does not fall over on a build with no source map to read", () => {
    expect(shellBreakdown([], [])).toEqual([]);
    // A source map with no embedded content still ranks nothing rather than NaN.
    expect(shellBreakdown(["../../src/ui/dom.ts"], [])).toEqual(["     0.0 kB  src/ui"]);
  });

  it("keeps static crawl pages out of the precache, and the app shell in", () => {
    // /tools.html cost 4.8 kB gzipped of a 275 kB budget to be available
    // offline, for a page the in-app All Tools view mirrors out of the shell
    // that is precached — and the sixty-eight per-tile crawl shells beside it
    // were never precached, so it was the odd one rather than the rule.
    expect(
      checkPrecacheContents(["/", "/index.html", "/assets/index-abc.js", "/manifest.webmanifest"]),
    ).toEqual([]);
    const violations = checkPrecacheContents(["/", "/index.html", "/tools.html"]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("/tools.html");
  });

  it("measures the sourceNote prose inside a shard, at any depth", () => {
    // Half the dataset weight is sentences rather than figures, and nobody had
    // that number until the breakdown printed it. Notes nest — a citation on a
    // jurisdiction, and another inside a local add-on — so the walk is
    // recursive rather than a top-level lookup.
    const shard = JSON.stringify({
      id: "US-XX",
      standardDeduction: 16100,
      citation: { sourceUrl: "https://example.gov", sourceNote: "abcde" },
      localAddOns: [{ id: "city", citation: { sourceNote: "fg" } }],
    });
    expect(sourceNoteBytes(shard)).toBe(7);
  });

  it("counts nothing for a shard with no notes, and survives one it cannot parse", () => {
    expect(sourceNoteBytes(JSON.stringify({ id: "US-XX", brackets: [] }))).toBe(0);
    // A shard that does not parse is the integrity gate's problem, not the
    // breakdown's — a report should not be the thing that fails the build.
    expect(sourceNoteBytes("{ not json")).toBe(0);
  });
});

describe("checkBundleBudget", () => {
  const kb = (n: number): number => n * 1024;

  it("passes a shell inside its budget", () => {
    expect(
      checkBundleBudget([
        { path: "/assets/index.js", gzipBytes: kb(220) },
        { path: "/assets/index.css", gzipBytes: kb(8) },
      ]),
    ).toEqual([]);
  });

  it("fails a shell over budget and names the chunks that grew", () => {
    const [violation] = checkBundleBudget([
      { path: "/assets/index.js", gzipBytes: kb(300) },
      { path: "/assets/index.css", gzipBytes: kb(9) },
      { path: "/index.html", gzipBytes: kb(1) },
    ]);
    expect(violation).toContain("310.0 kB gzipped");
    expect(violation).toContain(`over its ${SHELL_GZIP_BUDGET_KB} kB budget`);
    // A failure has to say *what* grew, or the next person just raises the number.
    expect(violation).toContain("/assets/index.js 300 kB");
    expect(violation).toContain("raise SHELL_GZIP_BUDGET_KB deliberately and say why");
  });

  it("treats an empty asset list as a failure, not a pass", () => {
    // Reading no assets means the build did not run. Silently passing there
    // would make the gate vanish exactly when it is least likely to be noticed.
    expect(checkBundleBudget([])[0]).toContain("run `npm run build`");
  });

  it("keeps the budget close enough to today's shell to be meaningful", () => {
    // A budget with unlimited headroom is not a budget. This pins the intent:
    // enough room for routine growth, not enough to absorb a new dependency.
    expect(SHELL_GZIP_BUDGET_KB).toBeGreaterThan(200);
    expect(SHELL_GZIP_BUDGET_KB).toBeLessThan(320);
  });
});

describe("the build under audit is the build of this tree", () => {
  /**
   * Every other check in the release audit reads `dist/`, and nothing checked
   * that `dist/` came from the code beside it. `npm run audit` on a stale build
   * printed "✓ Release audit passed" about an artifact three commits old — the
   * failure this file exists to prevent, in the file that exists to prevent it.
   * Two runs on 2026-09-02 reported the eager shell at 271.3 kB with 8.7 kB
   * free while the tree they stood in built to 275.2 kB with 4.8 kB free, and
   * that budget's whole headroom is a few kilobytes.
   */
  it("passes when the build is newer than every source it reads", () => {
    expect(checkBuildIsCurrent(1_000, 2_000, "src/tiles/x.ts")).toEqual([]);
  });

  it("passes when the build is exactly as new as the newest source", () => {
    // A build finishing in the same millisecond as the edit that triggered it
    // is not stale, and a coarse filesystem clock makes that an ordinary case
    // rather than a curiosity.
    expect(checkBuildIsCurrent(2_000, 2_000, "src/tiles/x.ts")).toEqual([]);
  });

  it("fails when a source has been edited since the build, and names it", () => {
    const [violation] = checkBuildIsCurrent(2_000, 1_000, "src/tiles/peaceOfMind.ts");
    expect(violation).toContain("dist/ is older");
    expect(violation).toContain("src/tiles/peaceOfMind.ts");
    expect(violation).toContain("npm run build");
  });

  it("says nothing when there is no build at all", () => {
    // "dist/index.html not found" is a violation this audit already reports, at
    // its own check. Two lines about one missing directory is noise, and the
    // other one names the file.
    expect(checkBuildIsCurrent(2_000, null, "src/tiles/x.ts")).toEqual([]);
  });
});
