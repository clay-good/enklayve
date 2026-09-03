import { describe, it, expect } from "vitest";
import { readerSource, readerText, shardValue, srcModules } from "../helpers/prose";

/**
 * A year written into prose is the year the shard beneath it actually carries.
 *
 * This site is a set of annual figures, and every annual figure gets rolled. The
 * sentence beside it does not roll itself: "We use the published 2026 figures"
 * stays on the page while the shard underneath moves to 2027, and it is a
 * sentence a reader has every reason to believe, because it is the one thing on
 * the page that says which year they are looking at.
 *
 * The dollar and rate sweeps ([`proseFigures.test.ts`](./proseFigures.test.ts),
 * [`proseRates.test.ts`](./proseRates.test.ts)) do not catch it. Rolling a
 * bracket table changes the amounts they compare, and they will report the new
 * amounts happily under a sentence still naming the old year.
 *
 * So each year a reader can see is either bound to the shard field it mirrors —
 * the roll then cannot be finished without fixing the sentence — or written down
 * as a date that does not move: when a statute took effect, when the federal
 * minimum wage last changed, which form revisions the readout can parse.
 */

/**
 * Years a reader could see: the ones inside string literals. A year in code is
 * a different thing — `EXAMPLE.bornYear = 1965`, `hours: 2080`, an
 * `EARLIEST_YEAR` bound — and reading those would drown the sweep in numbers
 * nobody is shown.
 *
 * A year touching a hyphen is skipped: it belongs to an ISO date
 * (`2026-05-29`), a shard id (`fafsa-2024-2025`), a document number
 * (`Rev. Proc. 2025-32`) or an award year (`2026-27`). Those are identifiers
 * and spans rather than claims about which year the figures are for. It is a
 * real gap in one place — the FAFSA and Pell tiles say "2026-27" — and it is
 * left rather than papered over, because an id and a date would have to be told
 * apart from a year first.
 */
export function proseYears(source: string): string[] {
  const strings =
    readerText(source).match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];
  return [...new Set(strings.join(" ").match(/(?<![\d-])(?:19|20)\d{2}(?![\d-])/g) ?? [])];
}

/**
 * The spans the single-year scan skips: `2026-27`, and the revenue procedures
 * and notices that look exactly like one — `Rev. Proc. 2025-32`,
 * `Notice 2025-67`. Both are claims worth checking rather than noise. An award
 * year is the year of the figures under it; a document number is the source the
 * shard cites, so a shard rolled to a new revenue procedure leaves the tile
 * naming the old one.
 *
 * An ISO date is excluded by the trailing guard: `2026-07-04` would otherwise
 * read as the span `2026-07`.
 */
export function proseSpans(source: string): string[] {
  const strings =
    readerText(source).match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];
  return [...new Set(strings.join(" ").match(/(?<!\d)(?:19|20)\d{2}-\d{2}(?![\d-])/g) ?? [])];
}

/** `2026` must not be found inside `12026` or `2026-27`, and may follow `FY`. */
export function statesYear(text: string, year: string): boolean {
  return new RegExp(`(?<![\\d-])${year}(?![\\d-])`).test(text);
}

/** The year a shard field carries, as a number or the year of an ISO date. */
function yearAt(id: string, path: string): string {
  const value = shardValue(id, path);
  if (typeof value === "number") return String(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 4);
  throw new Error(`${id}.${path} is not a year`);
}

interface YearBound {
  file: string;
  shard: string;
  path: string;
  why?: string;
}

const BOUND: YearBound[] = [
  // "Figures are the 2026 amounts", "We use the published 2026 figures", and the
  // other sentences that name the year the tile computes in.
  { file: "tiles/amtScreener.ts", shard: "amt-2024", path: "taxYear" },
  { file: "tiles/childTax.ts", shard: "child-tax-2024", path: "taxYear" },
  { file: "tiles/eitc.ts", shard: "eitc-ctc-2024", path: "taxYear" },
  { file: "tiles/giftTax.ts", shard: "gift-tax-2024", path: "taxYear" },
  { file: "tiles/iraDeduction.ts", shard: "ira-deduction-2024", path: "taxYear" },
  { file: "tiles/saversCredit.ts", shard: "savers-credit-2024", path: "taxYear" },
  { file: "tiles/federalIncomeTax.ts", shard: "federal-income-tax-2024", path: "taxYear" },
  {
    file: "tiles/snap.ts",
    shard: "snap-fy2024-contiguous",
    path: "fiscalYear",
    why: "the benefit year SNAP publishes on, written FY2026 in the prose",
  },
  {
    file: "tiles/acaPtc.ts",
    shard: "aca-2024",
    path: "year",
    why: "the year the restored 400% cliff applies to",
  },
  {
    file: "tiles/rmd.ts",
    shard: "rmd-uniform-lifetime-2024",
    path: "taxYear",
    why: "the year the required beginning age of 73 is stated for",
  },
  { file: "tiles/drawdown.ts", shard: "rmd-uniform-lifetime-2024", path: "taxYear" },
  {
    file: "tiles/collegeCost.ts",
    shard: "trump-accounts-2026",
    path: "taxYear",
    why: "the year of the §530A account this tile links to",
  },
  // The §530A pilot window and its opening date are shard fields, so the
  // sentence describing them is checked rather than trusted.
  { file: "tiles/trumpAccount.ts", shard: "trump-accounts-2026", path: "pilotBirthYearFirst" },
  { file: "tiles/trumpAccount.ts", shard: "trump-accounts-2026", path: "pilotBirthYearLast" },
  {
    file: "tiles/trumpAccount.ts",
    shard: "trump-accounts-2026",
    path: "contributionsOpenFrom",
    why: "contributions could not begin before July 4 of that year",
  },
];

/**
 * A year in prose that is not the year of a figure: when a statute took effect
 * or expires, when a rate last moved, which form revisions can be parsed. None
 * of these move when a shard rolls, and saying so is what keeps the ones that
 * DO move honest.
 */
const NOT_A_TAX_YEAR: Record<string, Record<string, string>> = {
  "tiles/acaPtc.ts": { "2025": "when the enhanced subsidies expired, which is history" },
  "tiles/autoLoan.ts": {
    "2025": "the first year of §163(h)(4), which the statute fixes",
    "2028": "its sunset, which the statute fixes",
    "2024": "the loan must be taken out after this year — a lien date, not a figure",
  },
  "tiles/deductionCopy.ts": {
    "2026": "when §170(p) took effect, a statutory date rather than the year of an amount",
    "2017": "the last year §68 applied before it was suspended",
    "2024": "the same §163(h)(4) lien date",
  },
  "tiles/benefitCliffs.ts": { "2026": "when the five new deductions took effect" },
  "tiles/retirementOptimizer.ts": {
    "2026":
      "the first year §414(v)(7)'s Roth catch-up requirement binds — Notice 2023-62 gave an administrative transition through 2025, so this is a fixed date in history rather than the shard's tax year, and it stays 2026 when the shard rolls",
  },
  "readout/report.ts": { "2026": "the same effective date, in the saved report" },
  "ui/shell.ts": { "2026": "the same effective date, on the home page" },
  "tiles/eobChecker.ts": { "2022": "when the No Surprises Act took effect" },
  "tiles/garnishment.ts": { "2009": "when the federal minimum wage last moved" },
  "data/statutes.ts": {
    "2026": "the tax year box 14b of the W-2 was added for",
    "2025": "the year before which an occupation must have customarily received tips",
  },
  "readout/extract.ts": {
    "2023": "a W-2 form revision the readout can parse",
    "2024": "a W-2 form revision the readout can parse",
    "2025": "a W-2 form revision the readout can parse",
    "2026": "a W-2 form revision the readout can parse",
  },
};

/**
 * A span in prose, and what it has to agree with.
 *
 * `award` is the award year of the figures, written `2026-2027` on the shard and
 * `2026-27` in the sentence. `document` is the revenue procedure or notice the
 * shard cites: the number is read back out of `citation.sourceDocument`, so a
 * shard rolled to next year's Rev. Proc. leaves the tile naming the old one and
 * fails here.
 */
const SPAN_BOUND: { file: string; shard: string; kind: "award" | "document"; why: string }[] = [
  {
    file: "tiles/pell.ts",
    shard: "fafsa-2024-2025",
    kind: "award",
    why: "the award year of the Pell figures",
  },
  {
    file: "tiles/fafsaSai.ts",
    shard: "fafsa-2024-2025",
    kind: "award",
    why: "the award year of the SAI methodology and tables",
  },
  {
    file: "tiles/amtScreener.ts",
    shard: "amt-2024",
    kind: "document",
    why: "the revenue procedure its shard cites",
  },
  {
    file: "tiles/giftTax.ts",
    shard: "gift-tax-2024",
    kind: "document",
    why: "the revenue procedure its shard cites",
  },
  {
    file: "tiles/iraDeduction.ts",
    shard: "ira-deduction-2024",
    kind: "document",
    why: "the notice its shard cites",
  },
];

/** The span a binding expects, read out of the shard. */
function spanOf(b: { shard: string; kind: "award" | "document" }): string {
  if (b.kind === "award") {
    const award = shardValue(b.shard, "awardYear");
    if (typeof award !== "string") throw new Error(`${b.shard}.awardYear is not a string`);
    // The shard writes both years in full; the sentence writes the second short.
    const [first, second] = award.split("-");
    return `${first}-${second!.slice(-2)}`;
  }
  const cited = shardValue(b.shard, "citation.sourceDocument");
  const span =
    typeof cited === "string" ? /(?<!\d)(?:19|20)\d{2}-\d{2}(?![\d-])/.exec(cited) : null;
  if (!span) throw new Error(`${b.shard} cites no document number`);
  return span[0];
}

describe("a year in the prose is the year in the shard", () => {
  const source = new Map(srcModules().map((f) => [f, readerSource(f)] as const));

  for (const b of BOUND) {
    const year = yearAt(b.shard, b.path);
    it(`${b.file} states ${year}${b.why ? ` — ${b.why}` : ` for ${b.shard}.${b.path}`}`, () => {
      expect(
        statesYear(source.get(b.file)!, year),
        `${b.file} does not state ${year}, which is ${b.shard}.${b.path}`,
      ).toBe(true);
    });
  }

  it("accounts for every year a reader can see", () => {
    const unaccounted: string[] = [];
    for (const [file, text] of source) {
      const bound = new Set(
        BOUND.filter((b) => b.file === file).map((b) => yearAt(b.shard, b.path)),
      );
      const allowed = NOT_A_TAX_YEAR[file] ?? {};
      for (const year of proseYears(text)) {
        if (!bound.has(year) && !(year in allowed)) unaccounted.push(`${file} ${year}`);
      }
    }
    expect(
      unaccounted.sort(),
      "bind it to the shard field it mirrors, or say in NOT_A_TAX_YEAR why it does not move",
    ).toEqual([]);
  });

  it("every entry in NOT_A_TAX_YEAR is a year that is really there", () => {
    const dead: string[] = [];
    for (const [file, allowed] of Object.entries(NOT_A_TAX_YEAR)) {
      const text = source.get(file);
      if (!text) {
        dead.push(`${file} (no such module)`);
        continue;
      }
      const found = new Set(proseYears(text));
      for (const year of Object.keys(allowed)) if (!found.has(year)) dead.push(`${file} ${year}`);
    }
    expect(dead.sort(), "delete the entry, or fix the year it was written for").toEqual([]);
  });

  for (const b of SPAN_BOUND) {
    const span = spanOf(b);
    it(`${b.file} states ${span} — ${b.why}`, () => {
      expect(
        proseSpans(source.get(b.file)!).includes(span),
        `${b.file} does not state ${span}`,
      ).toBe(true);
    });
  }

  it("accounts for every span a reader can see", () => {
    const unaccounted: string[] = [];
    for (const [file, text] of source) {
      const bound = new Set(SPAN_BOUND.filter((b) => b.file === file).map(spanOf));
      for (const span of proseSpans(text))
        if (!bound.has(span)) unaccounted.push(`${file} ${span}`);
    }
    expect(unaccounted.sort(), "bind it to the award year or the cited document it names").toEqual(
      [],
    );
  });

  it("reads years a reader sees and not years the code counts with", () => {
    expect(proseYears('const EXAMPLE = { bornYear: 1965 };\nconst a = "since 2009";')).toEqual([
      "2009",
    ]);
    expect(proseYears('const b = "dateRetrieved 2026-05-29";')).toEqual([]);
    expect(proseYears('const c = "Rev. Proc. 2025-32";')).toEqual([]);
    expect(proseYears('const d = "the FY2026 figures";')).toEqual(["2026"]);
  });

  it("does not find a year inside a longer number or a span", () => {
    expect(statesYear("the 2026-27 award year", "2026")).toBe(false);
    expect(statesYear("the FY2026 figures", "2026")).toBe(true);
    expect(statesYear("since 2009, which makes", "2009")).toBe(true);
  });
});
