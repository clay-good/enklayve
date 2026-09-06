import { describe, it, expect } from "vitest";
import {
  checkBuildIsCurrent,
  checkCsp,
  checkIndexHtml,
  checkProvenance,
  checkCitationLength,
  SOURCE_DOCUMENT_MAX,
  checkClientStorage,
  withoutComments,
  checkHarmTier,
  ADVICE_MARKERS,
  type AuditTile,
  checkBundleBudget,
  checkPrecacheContents,
  shellBreakdown,
  sourceNoteBytes,
  shellSummary,
  mappedBytesBySource,
  MIN_HEADROOM_KB,
  MEASUREMENT_SPREAD_KB,
  SHELL_GZIP_BUDGET_KB,
} from "../../scripts/audit-release";
import { TILES, SUB_TOOLS } from "../../src/tiles/registry";
import { CORE_SHELL } from "../../scripts/service-worker";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

/**
 * This was `checkLocalStorage`, and the name is why the hole lasted: a gate
 * named after one API looked at that one API. `sessionStorage`, IndexedDB,
 * cookies and the Cache API all outlive a page the same way, and a tile writing
 * a household's income into any of them passed an audit whose success line reads
 * "no sensitive persistence" — under a README stating, flatly, "auto-persisted
 * user data: 0". Nothing under `src/` used any of them; a hole closed rather
 * than a leak stopped.
 */
describe("audit: the client-storage boundary", () => {
  it("allows localStorage only in ui/theme.ts", () => {
    expect(
      checkClientStorage([{ path: "src/ui/theme.ts", content: "localStorage.setItem(k, v)" }]),
    ).toEqual([]);
  });

  it("flags localStorage anywhere financial", () => {
    expect(
      checkClientStorage([
        { path: "src/tiles/takeHome.ts", content: "localStorage.setItem('income', x)" },
      ]).length,
    ).toBe(1);
  });

  it("flags every other way a page can outlive itself", () => {
    const cases: [string, string][] = [
      ["sessionStorage", "sessionStorage.setItem('income', x)"],
      ["IndexedDB", "const db = indexedDB.open('enklayve')"],
      ["document.cookie", "document.cookie = 'income=' + x"],
      ["the Cache API", "await caches.open('answers')"],
      ["navigator.storage", "await navigator.storage.persist()"],
    ];
    for (const [name, content] of cases) {
      const found = checkClientStorage([{ path: "src/tiles/takeHome.ts", content }]);
      expect(found, name).toHaveLength(1);
      expect(found[0], name).toContain(name);
    }
  });

  it("does not let the theme allowance widen past localStorage", () => {
    // The carve-out is for a locale and theme preference, which is not
    // financial. It is not a general licence for that file.
    expect(
      checkClientStorage([
        { path: "src/ui/theme.ts", content: "const db = indexedDB.open('theme')" },
      ]).length,
    ).toBe(1);
  });

  it("reads a sentence about storage as a sentence", () => {
    // The narrow version scanned raw text, which it could afford to: nothing
    // says "localStorage" in prose outside theme.ts. It stops being affordable
    // the moment the words widen — the audit's own file says "the service
    // worker caches the shell", and `caches` is the CacheStorage global.
    expect(
      checkClientStorage([
        {
          path: "src/ui/shell.ts",
          content: "// the service worker caches the shell\nconst x = 1;",
        },
      ]),
    ).toEqual([]);
    expect(
      checkClientStorage([
        {
          path: "src/ui/shell.ts",
          content: "/** never written to sessionStorage */\nconst x = 1;",
        },
      ]),
    ).toEqual([]);
    expect(withoutComments("/* a */ code // b")).toBe(" code ");
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

  /**
   * The advice line, in every form §3.3 prescribes.
   *
   * §3.3's rule is one sentence: a Pillar 4 tool "is not legal, tax,
   * medical-billing, or benefits-eligibility determination". `ADVICE_MARKERS`
   * saw the first two and missed the last two, so a tile stating the line in the
   * spec's own benefits or medical-billing wording failed the gate. The Benefit
   * Cliff Explorer's copy is exactly that case — "not an eligibility
   * determination. Only the agency that runs a program decides who qualifies" —
   * and it is a better sentence than any of the eight that pass. It would have
   * failed the day that tile went to tier 2, and the only way through would have
   * been to reword good copy at a regex's request.
   *
   * The domains are read out of the spec rather than listed here, so adding a
   * fifth to §3.3 fails this test instead of quietly going unchecked.
   */
  const SPEC = readFileSync(resolve(__dirname, "..", "..", "docs", "specs", "SPEC-4.md"), "utf8");
  const DOMAINS = (/It is not ([^.]+) determination\./.exec(SPEC)?.[1] ?? "")
    .split(/,| or /)
    .map((d) => d.trim())
    .filter((d) => d.length > 0);

  it("reads the domains out of SPEC-4 §3.3 rather than trusting a list here", () => {
    // If the spec sentence is reworded so this stops matching, the test below
    // would pass over an empty list — which is the way a check like this rots.
    expect(DOMAINS).toContain("legal");
    expect(DOMAINS).toContain("medical-billing");
    expect(DOMAINS).toContain("benefits-eligibility");
    expect(DOMAINS.length).toBeGreaterThanOrEqual(4);
  });

  for (const domain of DOMAINS) {
    it(`accepts the line stated as ${domain}`, () => {
      // Either the adjective form ("not legal advice") or the noun form ("not a
      // benefits-eligibility determination"). A domain the gate can see in
      // neither form is a domain the spec requires and the gate rejects.
      const forms = [
        `This is information about published rules. It is not ${domain} advice.`,
        `This is an estimate, not a ${domain} determination. Only the agency decides.`,
      ];
      const accepted = forms.filter((how) => ADVICE_MARKERS.some((re) => re.test(how)));
      expect(accepted.length, `no marker matches either form for "${domain}"`).toBeGreaterThan(0);
    });
  }

  it("accepts the Benefit Cliff Explorer's own wording, which used to fail", () => {
    const how =
      "This is an estimate from public data and the figures you enter, not an eligibility " +
      "determination. Only the agency that runs a program decides who qualifies.";
    expect(checkHarmTier([{ id: "cliff-explorer", pillar: "rough", harmTier: 2, how }])).toEqual(
      [],
    );
  });

  it("still rejects a how block that claims nothing about advice at all", () => {
    // Widening the markers must not widen them into everything.
    const violations = checkHarmTier([
      {
        id: "bill-triage",
        pillar: "rough",
        harmTier: 2,
        how: "Sorts your bills by what happens if each goes unpaid, worst consequence first.",
      },
    ]);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("omits the advice line");
  });

  it("leaves no marker in the list that matches nothing", () => {
    // `/\bnot advice\b/` had never matched a tile — every one says "not legal or
    // financial advice", with words between — so the list was one regex wearing
    // the look of two. A marker is either exercised or it is decoration.
    const catalog = [...TILES, ...SUB_TOOLS.map((s) => s.tile)].map((t) => t.how ?? "");
    const specForms = DOMAINS.flatMap((d) => [
      `It is not ${d} advice.`,
      `It is not a ${d} determination.`,
    ]);
    const corpus = [...catalog, ...specForms, "It is not advice."];
    for (const re of ADVICE_MARKERS) {
      expect(
        corpus.some((text) => re.test(text)),
        `marker ${re} matches nothing in the catalog or in §3.3's own forms`,
      ).toBe(true);
    }
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
    // The headroom CI will have, not the one this machine has: 265 − 242 − the
    // half-kilobyte CI reads heavier. The local figure is what got quoted into
    // the README and the checklist for a shell CI had less room for.
    expect(line).toContain("22.5 kB free in CI");
    expect(line).toContain("2 assets");
    // Naming the biggest one is what turns the number into somewhere to look.
    expect(line).toContain("/assets/index-abc.js");
  });

  it("says a negative headroom rather than hiding it behind a zero", () => {
    const line = shellSummary([{ path: "/a.js", gzipBytes: kb(300) }], 265);
    expect(line).toContain("-35.5 kB free in CI");
  });

  it("does not fall over on an empty precache list", () => {
    expect(() => shellSummary([], SHELL_GZIP_BUDGET_KB)).not.toThrow();
  });

  it("keeps the README's shell figure with the budget it is measured against", () => {
    // The README has a paragraph explaining why the shell costs what it costs,
    // and it opened with "280 kB gzipped" while the budget had been raised to
    // 284 underneath it — two raises out of date, in the one place a reader
    // goes to understand the number. It is a claim about the build, so it
    // drifts exactly the way a count in a comment does, and nothing was
    // watching it.
    //
    // Held against the pinned budget rather than against a build, so this stays
    // in the unit suite: the shell is always just under its budget by
    // construction — that is what the gate enforces — so a figure far below it
    // is stale and a figure above it is impossible. Raising the budget without
    // re-measuring the prose fails here.
    const readme = readFileSync(resolve(__dirname, "..", "..", "README.md"), "utf8");
    const stated = /\*\*([\d.]+) kB gzipped\*\* across the whole precached shell/.exec(readme);
    expect(stated, "the README no longer states the precached shell's size").not.toBeNull();
    const kb = Number(stated![1]);
    expect(kb).toBeLessThanOrEqual(SHELL_GZIP_BUDGET_KB);
    // The tolerance is derived rather than picked. The gate keeps the shell
    // under the budget by at least MIN_HEADROOM once MEASUREMENT_SPREAD_KB is
    // taken off, so a truthful figure sits within about that much of the
    // budget; one kilobyte of slack on top covers the build-to-build wobble
    // that is not worth a doc edit. A flat 3 was the number before, and it was
    // wide enough to miss the figure going stale by 0.6 kB inside a single day
    // — which is exactly the drift this check exists for, and which it did
    // miss on 2026-09-05. Tying it to the gate's own constants means a change
    // to the budget or to the headroom rule moves this with it.
    const slackKb = MIN_HEADROOM_KB + MEASUREMENT_SPREAD_KB + 1;
    expect(
      SHELL_GZIP_BUDGET_KB - kb,
      `the README's shell figure is more than ${slackKb} kB under the budget, so it is stale — ` +
        "re-measure it with `npm run build && npm run audit` rather than adjusting this",
    ).toBeLessThanOrEqual(slackKb);
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

  /**
   * The breakdown ranked by how long each source file is, and this codebase's
   * source is mostly prose. Measured on 2026-09-05: 64% of `src/` never reaches
   * the chunk, and the ranking was wrong where it mattered —
   * `src/data/schemas.ts` came first at 70.3 kB of source and is third at 12.6
   * kB of chunk, 82% of it documentation and types that are erased at build
   * time. That is the wrong answer from the tool whose job is saying what to
   * trim, on a day the budget had 0.3 kB left: acting on it meant deleting
   * documentation from the file with the least to give.
   */
  it("charges each source the bytes it occupies in the generated file", () => {
    // Two segments on one line. Each is [columnDelta, sourceIndex, line,
    // column]; the first starts at column 0 and the second at column 10, so the
    // first source owns 10 bytes. The last segment on a line has no successor
    // to measure against and is charged nothing.
    const mappings = "AAAA,UAAA";
    const bytes = mappedBytesBySource(
      JSON.stringify({ mappings, sources: ["../../src/a.ts", "../../src/b.ts"] }),
    );
    expect(bytes).toEqual([10, 0]);
  });

  it("accumulates across lines and keeps the source index running between them", () => {
    // Source indices are deltas that persist across lines, which is the part a
    // hand-rolled decoder gets wrong: the second line's `A` means "same source
    // as last time", not "source 0".
    // Line one moves to source 1 on its second segment; line two's leading `A`
    // is a delta of zero, so it must still be source 1. A decoder that reset
    // per line would charge those 16 bytes to source 0 instead.
    const bytes = mappedBytesBySource(
      JSON.stringify({
        mappings: "AAAA,UCAA;AAAA,gBAAA",
        sources: ["../../src/a.ts", "../../src/b.ts"],
      }),
    );
    expect(bytes[0]).toBe(10);
    expect(bytes[1]).toBe(16);
  });

  it("returns nothing rather than throwing on a map it cannot read", () => {
    // This runs inside a report, not a gate. A map that is missing, truncated
    // or not JSON at all must cost the reader the composition, never the
    // headroom figure printed above it.
    expect(mappedBytesBySource("not json")).toEqual([]);
    expect(mappedBytesBySource("{}")).toEqual([]);
    expect(mappedBytesBySource(JSON.stringify({ mappings: "AAAA", sources: [] }))).toEqual([]);
    expect(mappedBytesBySource(JSON.stringify({ mappings: "!!!!", sources: ["a.ts"] }))).toEqual([
      0,
    ]);
  });

  it("feeds the ranking, so a comment-heavy file stops outranking a large one", () => {
    // The regression in one assertion: `schemas.ts` with a lot of source and
    // little output must rank below `shell.ts` with the reverse.
    const sources = ["../../src/data/schemas.ts", "../../src/ui/shell.ts"];
    const bySourceLength = shellBreakdown(sources, [70_000, 40_000]);
    const byGeneratedBytes = shellBreakdown(sources, [12_600, 17_400]);
    expect(bySourceLength[0]).toContain("src/data");
    expect(byGeneratedBytes[0]).toContain("src/ui");
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

  it("pins the precache seed, so the budget's lever list cannot describe a shell that moved", () => {
    // The unit test above proves the *rule*. This pins the *set*, which is the
    // half that went stale: the budget comment spent two days offering
    // `/tools.html` as the alternative to raising the number, after it had
    // already left the precache and after `checkPrecacheContents` became a gate
    // keeping it out. A lever a gate forecloses is not a lever, and re-quoting
    // one inside a paragraph that says the levers were re-checked is how a
    // measurement outlives the thing it measured.
    //
    // The seed lived as a literal inside `vite.config.ts`, where no test could
    // see it. Adding a sixth entry now means editing this list too, which is
    // the moment to ask what a first visit is paying for — and the moment the
    // budget comment needs rewriting rather than re-quoting.
    expect([...CORE_SHELL]).toEqual([
      "/",
      "/index.html",
      "/manifest.webmanifest",
      "/favicon.svg",
      "/icon.svg",
    ]);
    // And the seed itself must satisfy rule 8: no crawl page may enter this way.
    expect(checkPrecacheContents(CORE_SHELL)).toEqual([]);
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

  it("fails a shell that is inside the budget by less than the spread between machines", () => {
    // The rule was written into the budget's own comment and never enforced, so
    // it held for one raise: 284 was set locally with 0.2 kB free, CI measured
    // 284.4 on the same tree, and three commits went to `main` green here and
    // red there. A pass this machine cannot promise another machine will repeat
    // is not a pass.
    //
    // And it was then measured against the local figure, so it lasted one more
    // raise: 1.0 kB free here is 0.5 in CI, which fails the same rule after the
    // push. Eight commits went to `main` that way on 2026-09-05. The spread
    // comes off before the rule is applied now.
    const [violation] = checkBundleBudget([{ path: "/assets/index.js", gzipBytes: kb(99.5) }], 100);
    expect(violation).toContain("99.5 kB gzipped");
    expect(violation).toContain("leaves 0.0 kB under its 100 kB budget");
    expect(violation).toContain(`less than the ${MIN_HEADROOM_KB} kB`);
    expect(violation).toContain("/assets/index.js 100 kB");
  });

  it("passes a shell with headroom to spare", () => {
    expect(checkBundleBudget([{ path: "/assets/index.js", gzipBytes: kb(90) }], 100)).toEqual([]);
  });

  it("keeps the headroom rule wider than the spread it exists for", () => {
    // 0.4-0.6 kB is the observed difference between two zlib versions. A rule
    // that only just covers it is the same mistake in a smaller size.
    expect(MIN_HEADROOM_KB).toBeGreaterThan(0.6);
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
