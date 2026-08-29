import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname, normalize } from "node:path";
import { TILES, SUB_TOOLS } from "../../src/tiles/registry";
import { toolPages } from "../../scripts/tool-pages";
import { ManifestSchema } from "../../src/data/schemas";

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
 * Each pattern must match **at least once**, so rewording the sentence a claim
 * lives in fails loudly rather than silently turning the check off — which is
 * the usual way a test like this rots into decoration.
 */
const ROOT = resolve(__dirname, "..", "..");
const README = readFileSync(resolve(ROOT, "README.md"), "utf8");
const manifest = ManifestSchema.parse(
  JSON.parse(readFileSync(resolve(ROOT, "data", "manifest.json"), "utf8")),
);

interface Claim {
  what: string;
  /** The truth, read from the code or the data. */
  value: number;
  /** Every phrasing the README uses for it. Group 1 is the number. */
  patterns: RegExp[];
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
    patterns: [/unit\/golden across (\d+) files/g, /unit\/golden tests across (\d+) files/g],
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
          const found = [...README.matchAll(pattern)].map((m) => Number(m[1]!.replace(/,/g, "")));
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
