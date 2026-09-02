import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname, normalize } from "node:path";
import { TILES, SUB_TOOLS } from "../../src/tiles/registry";
import { toolPages } from "../../scripts/tool-pages";
import { ManifestSchema } from "../../src/data/schemas";
import { ADAPTERS } from "../../scripts/refresh/adapters";

/**
 * The README's counts must be true (SPEC §2 principle 5, in spirit).
 *
 * The README opens with a "By the numbers" table that promises "every figure
 * here is reproducible from the repo, not marketing". It had quietly stopped
 * being: it claimed 63 calculators in 10 hubs against a real 68 in 12, 78 cited
 * shards against 80, and 69 crawlable pages against 80 — drift accumulated over
 * several phases that each added a tool and forgot the sentence describing how
 * many there are.
 *
 * A number in a document is a claim, and a claim nothing checks is a claim that
 * will be wrong eventually. This checks them.
 *
 * The corollary is why the README no longer states a test *count*. That was the
 * one number in the table nothing here could derive, and on 2026-08-30 it was
 * corrected by hand four times in a morning — each time only because the file
 * count happened to move with it, so tests added to an existing file would have
 * left it stale in silence. `vitest list --json` does produce it exactly, but
 * spawning that from inside a running suite deadlocks. Rather than keep a
 * figure under a promise of "reproducible from the repo, not marketing" that
 * nothing reproduces, the sentence now states the file count, which is checked
 * below. If the number ever comes back, it needs a check to come back with it.
 *
 * Each pattern must match **at least once**, so rewording the sentence a claim
 * lives in fails loudly rather than silently turning the check off — which is
 * the usual way a test like this rots into decoration.
 */
const ROOT = resolve(__dirname, "..", "..");
const README = readFileSync(resolve(ROOT, "README.md"), "utf8");
/**
 * Some claims are made in more than one document and drift independently. The
 * refresh pipeline's "N of M adapters watch their shard" was stated in three
 * places and all three went stale within hours of each other on 2026-08-30, so
 * those claims are checked against every prose file rather than the README
 * alone. The phrasing is deliberately one fixed sentence fragment: the same
 * page also carries a *historical* "30 of 49 adapters no longer anchoring",
 * which is true and must not be rewritten to today's number.
 */
const PROSE = [
  "README.md",
  "docs/data-sources.md",
  "docs/launch-checklist.md",
  "docs/adding-a-state.md",
  "docs/contributing.md",
].map((f) => readFileSync(resolve(ROOT, f), "utf8"));
const baseline = JSON.parse(
  readFileSync(resolve(ROOT, "scripts", "refresh", "adapter-baseline.json"), "utf8"),
) as { knownAnchoring: string[] };
const manifest = ManifestSchema.parse(
  JSON.parse(readFileSync(resolve(ROOT, "data", "manifest.json"), "utf8")),
);

interface Claim {
  what: string;
  /** The truth, read from the code or the data. */
  value: number;
  /** Every phrasing the README uses for it. Group 1 is the number. */
  patterns: RegExp[];
  /** Check every prose file, not the README alone. */
  prose?: boolean;
}

/** Every `*.test.ts` under `tests/`, which is what "across N files" counts. */
function testFileCount(dir = resolve(ROOT, "tests")): number {
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) n += testFileCount(p);
    else if (name.endsWith(".test.ts")) n += 1;
  }
  return n;
}

/** Every Playwright spec under `e2e/`. */
function e2eSpecCount(): number {
  return readdirSync(resolve(ROOT, "e2e")).filter((f) => f.endsWith(".spec.ts")).length;
}

const CLAIMS: Claim[] = [
  {
    what: "calculators",
    value: SUB_TOOLS.length,
    patterns: [
      /\*\*(\d+) deterministic calculators\*\*/g,
      /\*\*(\d+)\*\* in \*\*\d+ topic hubs\*\*/g,
      /all (\d+) calculators/g,
      /All (\d+) calculators \(plus/g,
      /(\d+) calculators in \d+ hubs/g,
      /One module per calculator \((\d+) of them\)/g,
    ],
  },
  {
    what: "topic hubs",
    value: TILES.length,
    patterns: [
      /\*\*\d+\*\* in \*\*(\d+) topic hubs\*\*/g,
      /\*\*(\d+) plainly-named topic hubs\*\*/g,
      /\d+ calculators in (\d+) hubs/g,
    ],
  },
  {
    what: "cited dataset shards",
    value: manifest.datasets.length,
    patterns: [/Cited dataset shards \| \*\*([\d,]+)\*\*/g],
  },
  {
    what: "crawlable tool pages",
    value: toolPages().length,
    patterns: [/all (\d+) pages are reachable/g],
  },
  {
    what: "test files",
    value: testFileCount(),
    patterns: [/unit\/golden across \*\*(\d+)\*\* files/g, /golden suite across (\d+) files/g],
  },
  {
    what: "adapters watching their shard",
    value: baseline.knownAnchoring.length,
    prose: true,
    patterns: [/(\d+) of \d+ adapters watch their shard/g],
  },
  {
    what: "refresh adapters in total",
    value: ADAPTERS.length,
    prose: true,
    patterns: [/\d+ of (\d+) adapters watch their shard/g],
  },
  {
    what: "tax jurisdictions",
    value: manifest.datasets.filter((d) => d.kind === "state-income-tax").length,
    patterns: [/\*\*(\d+) — every one of the 50 states \+ DC\*\*/g],
  },
];

describe("the README's counts are reproducible from the repo", () => {
  for (const claim of CLAIMS) {
    describe(claim.what, () => {
      for (const pattern of claim.patterns) {
        it(`is ${claim.value} everywhere it is stated as /${pattern.source}/`, () => {
          const corpus = claim.prose ? PROSE : [README];
          const found = corpus.flatMap((text) =>
            [...text.matchAll(pattern)].map((m) => Number(m[1]!.replace(/,/g, ""))),
          );
          // A pattern that matches nothing is a check that has been switched off
          // by a reword. That must fail, not pass quietly.
          expect(found.length, `no README text matches /${pattern.source}/`).toBeGreaterThan(0);
          for (const n of found) expect(n).toBe(claim.value);
        });
      }
    });
  }

  it("has at least one Playwright spec behind the e2e claim", () => {
    // The e2e *test* count is not derivable without running the suite, so this
    // asserts the weaker but still useful thing: the specs the claim rests on
    // exist. The unit-test total is likewise left as prose — a check that fails
    // on every added test is a check that gets deleted.
    expect(e2eSpecCount()).toBeGreaterThan(0);
    expect(README).toMatch(/\d+ Playwright e2e/);
  });

  it("counts a crawlable page for every hub and every calculator", () => {
    // The page count is only meaningful if it is what the build actually emits.
    expect(toolPages().length).toBe(TILES.length + SUB_TOOLS.length);
  });
});

/**
 * Every link the docs make to a file in this repo resolves.
 *
 * The README alone points at ~250 paths — engine modules, tiles, tests,
 * datasets, workflows — and that is the whole reason it is credible: a claim
 * you can click into is checkable, and one you cannot is marketing. A link to a
 * file that has been renamed or deleted is the same silent rot as a rotted
 * external link, which is already checked monthly. Two of the specs referenced
 * tiles that had been retired before this test existed.
 */
describe("every internal doc link resolves", () => {
  function markdownFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      if (["node_modules", ".git", "dist", "playwright-report", "test-results"].includes(name)) {
        continue;
      }
      const p = join(dir, name);
      if (statSync(p).isDirectory()) out.push(...markdownFiles(p));
      else if (name.endsWith(".md")) out.push(p);
    }
    return out;
  }

  // `](path)` or `](path#anchor)`, skipping external and mail links.
  const LINK = /\]\(([^)#\s]+)(?:#[^)]*)?\)/g;

  const files = markdownFiles(ROOT);

  it("finds the docs it is supposed to be checking", () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.endsWith("README.md"))).toBe(true);
  });

  it("resolves every repo-relative link in every markdown file", () => {
    const broken: string[] = [];
    let checked = 0;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(LINK)) {
        const target = match[1]!;
        if (/^(https?:|mailto:|\/\/)/.test(target)) continue;
        checked += 1;
        const resolved = normalize(join(dirname(file), target));
        if (!existsSync(resolved)) {
          broken.push(`${file.slice(ROOT.length + 1)} -> ${target}`);
        }
      }
    }
    // A pattern that matches nothing is a check switched off by a reword.
    expect(checked, "no repo-relative links found — is the pattern still right?").toBeGreaterThan(
      100,
    );
    expect(broken).toEqual([]);
  });

  it("would catch a link to a file that does not exist", () => {
    // Guards the guard: without this, a regex change that silently stops
    // matching would leave the suite green and the links unchecked.
    const target = "src/tiles/thisTileWasDeleted.ts";
    expect(existsSync(join(ROOT, target))).toBe(false);
    const sample = `See [the tile](${target}) for details.`;
    const found = [...sample.matchAll(LINK)].map((m) => m[1]);
    expect(found).toEqual([target]);
  });
});

/**
 * The state coverage cheat sheet quotes a rate for nearly every state, and
 * nothing compared those rates with the shards the engine computes from.
 *
 * It is the table a reader scans to see whether their state is right — 25
 * parentheticals, most of them a rate or a range — and it sits in the file the
 * repo already promises is "reproducible from the repo, not marketing". The
 * counts in that promise are checked. The rates were not, and a state rolling
 * to a new rate would leave the table quietly wrong in the most-read place it
 * could be.
 *
 * The rule is the general one, so a state added to the table is checked the day
 * it lands: every percentage inside a state's parenthetical is a bracket rate on
 * that state's shard. Four are something else, and each says what:
 *
 *   - MA's "+4%" and ME's "+2% surtax" are increments the engine models as a
 *     top tier (5.0 + 4 = 9.0, 7.15 + 2 = 9.15), so they are DERIVED from the
 *     shard rather than excused -- top rate minus the base below it;
 *   - MD's county range is on `localAddOns`, 24 counties deep, so it is checked
 *     against the min and max of those;
 *   - WV's "2026 5% cut" is a rate CHANGE, not a rate, and is the only entry
 *     here that is written down rather than computed.
 */
describe("the cheat sheet's rates are the shards' rates", () => {
  const CHEAT_SHEET = (() => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const start = readme.indexOf("### State coverage cheat sheet");
    expect(start, "the cheat-sheet heading moved or was renamed").toBeGreaterThan(-1);
    const end = readme.indexOf("\n## ", start);
    return readme.slice(start, end === -1 ? undefined : end);
  })();

  /** `MD (state 2%→6.5%, plus a county tax 2.25%–3.30%)` → `["MD", "state 2%…"]`. */
  const PARENTHETICAL = /\b([A-Z]{2})\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;

  const shardOf = (code: string): Record<string, unknown> =>
    JSON.parse(
      readFileSync(join(ROOT, "data", `state-${code.toLowerCase()}-income-tax-2024.json`), "utf8"),
    ) as Record<string, unknown>;

  const pct = (n: number): number => Number((n * 100).toFixed(4));

  /** Every bracket rate on a shard, across every filing status. */
  function bracketRates(code: string): Set<number> {
    const byStatus = shardOf(code).bracketsByFilingStatus as Record<
      string,
      { rate: number; lowerBound: number }[]
    >;
    const out = new Set<number>();
    for (const schedule of Object.values(byStatus)) for (const b of schedule) out.add(pct(b.rate));
    return out;
  }

  /** A surtax the engine folds into the top tier: the top rate less the one below it. */
  function topTierIncrement(code: string): number {
    const sorted = [...bracketRates(code)].sort((a, b) => a - b);
    return Number((sorted[sorted.length - 1]! - sorted[sorted.length - 2]!).toFixed(4));
  }

  /** Maryland's county tax, which is 24 entries on `localAddOns` rather than a bracket. */
  function localAddOnRates(code: string): number[] {
    const addOns = shardOf(code).localAddOns as {
      flatRate?: number;
      brackets?: { rate: number }[];
    }[];
    return addOns.flatMap((a) => [
      ...(a.flatRate === undefined ? [] : [pct(a.flatRate)]),
      ...(a.brackets ?? []).map((b) => pct(b.rate)),
    ]);
  }

  /** A percentage in the table that is not a rate on the shard, and what it is. */
  const NOT_A_BRACKET_RATE: Record<string, Record<number, string>> = {
    WV: { 5: "the size of the 2026 cut, which is a change in a rate and not one" },
  };

  const claims = [...CHEAT_SHEET.matchAll(PARENTHETICAL)]
    .map(([, code, body]) => ({
      code: code!,
      rates: [...body!.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1])),
    }))
    .filter(
      (c) =>
        c.rates.length > 0 &&
        existsSync(join(ROOT, "data", `state-${c.code.toLowerCase()}-income-tax-2024.json`)),
    );

  it("finds the table and the states in it", () => {
    // A pattern that matches nothing is a check switched off by a reword.
    expect(claims.length).toBeGreaterThan(15);
    expect(claims.map((c) => c.code)).toContain("PA");
  });

  for (const { code, rates } of claims) {
    it(`${code} states ${rates.map((r) => `${r}%`).join(", ")}, and the shard agrees`, () => {
      const onShard = bracketRates(code);
      const local = code === "MD" ? localAddOnRates(code) : [];
      const increment = topTierIncrement(code);
      const allowed = NOT_A_BRACKET_RATE[code] ?? {};
      const unmatched = rates.filter(
        (r) =>
          !onShard.has(r) &&
          r !== increment &&
          !(local.length > 0 && (r === Math.min(...local) || r === Math.max(...local))) &&
          !(r in allowed),
      );
      expect(
        unmatched,
        `${code}: ${unmatched.join(", ")} appears in the cheat sheet and nowhere on its shard`,
      ).toEqual([]);
    });
  }
});

/**
 * A worked result the README quotes is a value the golden corpus actually pins.
 *
 * Ninety-six of them are written as `single $60k → $1,882.67`, one or more per
 * state, and they are the README's strongest claim: not "we model Missouri" but
 * "here is what it computes, and a test holds it". Nothing compared them with
 * the tests.
 *
 * Two were wrong when this was written, and wrong in the way that matters. The
 * Missouri paragraph quoted **$1,887.36 / $1,130.66** against a corpus pinning
 * **$1,882.67 / $1,125.97** — and the same paragraph still described the
 * pre-roll schedule ($1,313 steps, top rate above $9,191) and said the 2026
 * indexed thresholds "roll as the reviewer's data-only step", after that roll
 * had happened. The shard, the engine and the golden cases had all moved
 * together to the DOR's 2026 formula; the sentence describing them had not.
 *
 * The check is presence, not attribution: a figure has to appear as an EXPECTED
 * value somewhere in `tests/golden`, matched against the argument of a `toBe`
 * rather than any number in the file — which is what makes it precise enough to
 * have caught these two, since a loose scan of every number in the corpus finds
 * them by coincidence. It cannot catch a right figure filed under the wrong
 * state; it catches the one that actually happens, which is a figure going stale
 * where the number beneath it moved.
 */
describe("the README's worked results are the corpus's", () => {
  const README = readFileSync(join(ROOT, "README.md"), "utf8");
  const GOLDEN = join(ROOT, "tests", "golden");

  /** Every `expect(...).toBe(<number or numeric string>)` in the golden corpus. */
  const pinned = (() => {
    const out = new Set<number>();
    for (const name of readdirSync(GOLDEN)) {
      if (!name.endsWith(".ts")) continue;
      const text = readFileSync(join(GOLDEN, name), "utf8");
      for (const m of text.matchAll(/\.toBe\(\s*"?(-?\d+(?:\.\d+)?)"?\s*\)/g)) {
        out.add(Number(m[1]));
      }
    }
    return out;
  })();

  const claims = [...README.matchAll(/(?:→|->)\s*\*{0,2}\$([\d,]+\.\d{2})/g)].map((m) =>
    Number(m[1]!.replace(/,/g, "")),
  );

  it("finds the corpus and the claims", () => {
    // Either pattern matching nothing is a check switched off by a reword.
    expect(pinned.size, "no expected values found in tests/golden").toBeGreaterThan(200);
    expect(claims.length, "no worked results found in the README").toBeGreaterThan(50);
  });

  it("pins every figure the README says is golden-tested", () => {
    const unpinned = claims.filter((c) => !pinned.has(c));
    expect(
      unpinned,
      "the README quotes a result no golden case expects — the shard moved and the sentence did not",
    ).toEqual([]);
  });
});
