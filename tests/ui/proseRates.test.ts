import { describe, it, expect } from "vitest";
import {
  declaredConstant,
  readerSource,
  readerText,
  shardNumber,
  srcModules,
} from "../helpers/prose";

/**
 * A rate written into prose says the same thing as the shard or the constant the
 * code computes with — the percentage half of the sweep that
 * [`proseFigures.test.ts`](./proseFigures.test.ts) does for dollar amounts.
 *
 * That sweep was widened twice in a day and still read only dollar signs, which
 * left every rate in the codebase unchecked: `6.2%`, `1.45%`, `85%`, `138%`,
 * `26% / 28%` — figures somebody legislates, sitting in sentences beside the
 * tiles that compute from a shard, with nothing comparing the two. A rate drifts
 * exactly the way an amount does. The FICA wage base moves every year and its
 * rates do not, which is worse rather than better: the sentence that has been
 * right for a decade is the one nobody re-reads.
 *
 * Writing it found the thing a dollar sweep structurally cannot: IRC
 * §1402(a)(12)'s 92.35% self-employment base was an inline `0.9235` in
 * `src/engine/tax/fica.ts`. The named-constant gate fires on a bare number of
 * 100 or more — a threshold chosen so that array indices and month counts do not
 * trip it — and no rate is ever 100 or more. Every rate in the engine was
 * outside every gate here.
 *
 * The completeness half is the point, as it was there: EVERY percentage in every
 * module under `src/` is either bound below or written down as not a rate.
 */

/** `6.2`, `1.45`, `100` and `0.5` as the prose writes them. */
export function asRate(percent: number): string {
  return `${Number(percent.toFixed(6))}%`;
}

/**
 * `20%` must not be found inside `120%`, and `8%` must not be found inside
 * `3.8%`. Only the left side needs guarding: the `%` already ends the match, so
 * no longer rate can begin with a shorter one.
 */
export function statesRate(text: string, rate: string): boolean {
  return new RegExp(`(?<![\\d.])${rate.replace(".", "\\.")}`).test(text);
}

/** Every percentage a reader could see in one module. */
export function proseRates(source: string): string[] {
  return [...new Set(readerText(source).match(/\d{1,3}(?:\.\d+)?%/g) ?? [])];
}

interface RateBound {
  file: string;
  /** Dotted path(s) into one shard. */
  shard?: string;
  path?: string | string[];
  /** Or a named constant, and the `src/` module declaring it. */
  constant?: { name: string; in: string };
  /**
   * From the field value(s) to the percentage the prose writes. The default
   * treats a shard field as a fraction (`0.062` → `6.2%`); a field already in
   * points of the poverty line (`138`) passes `(n) => n`.
   */
  derive?: (...values: number[]) => number;
  why?: string;
}

const asPoints = (n: number) => n;

const BOUND: RateBound[] = [
  // The two AMT rates, in the line that names them both.
  { file: "tiles/amtScreener.ts", shard: "amt-2024", path: ".rateLow" },
  { file: "tiles/amtScreener.ts", shard: "amt-2024", path: ".rateHigh" },

  // The preferential long-term schedule, quoted as "0%, 15%, and 20%".
  {
    file: "tiles/capitalGains.ts",
    shard: "capital-gains-2024",
    path: ".longTermBracketsByFilingStatus.single.0.rate",
  },
  {
    file: "tiles/capitalGains.ts",
    shard: "capital-gains-2024",
    path: ".longTermBracketsByFilingStatus.single.1.rate",
  },
  {
    file: "tiles/capitalGains.ts",
    shard: "capital-gains-2024",
    path: ".longTermBracketsByFilingStatus.single.2.rate",
  },
  {
    file: "tiles/capitalGains.ts",
    shard: "capital-gains-2024",
    path: ".netInvestmentIncomeTaxRate",
  },

  // The employee's half of FICA, named in the tile that shows what an employer
  // would have covered.
  {
    file: "tiles/contractVsSalary.ts",
    shard: "fica-2024",
    path: [".socialSecurityRate", ".medicareRate"],
    derive: (ss, medicare) => (ss + medicare) * 100,
    why: "the employee-side FICA rate, the two halves added",
  },

  {
    file: "tiles/deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".seniorDeduction.phaseOutRate",
  },
  {
    file: "tiles/deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".charitableFloor.rate",
  },
  {
    file: "tiles/deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".bracketsByFilingStatus.single.6.rate",
    why: "the top bracket, which is where §68 applies",
  },

  { file: "tiles/educationCredits.ts", shard: "education-credits-2024", path: ".aotc.tier1Rate" },
  { file: "tiles/educationCredits.ts", shard: "education-credits-2024", path: ".aotc.tier2Rate" },
  {
    file: "tiles/educationCredits.ts",
    shard: "education-credits-2024",
    path: ".aotc.refundableRate",
  },
  { file: "tiles/educationCredits.ts", shard: "education-credits-2024", path: ".llc.rate" },

  {
    file: "tiles/fpl.ts",
    shard: "medicaid-2024",
    path: ".expansionThresholdPctFpl",
    derive: asPoints,
  },
  {
    file: "tiles/fpl.ts",
    shard: "aca-2024",
    path: ".applicablePercentage.5.fplHigh",
    derive: asPoints,
    why: "the top of the premium-tax-credit range, restored for 2026",
  },
  {
    file: "tiles/acaPtc.ts",
    shard: "aca-2024",
    path: ".applicablePercentage.5.fplHigh",
    derive: asPoints,
    why: "the cliff the tile warns about, read from the last applicable-percentage band",
  },
  // The screener used to write 138% into its Medicaid note, which is why this
  // list bound it to the shard. It interpolates the shard's own field now — and
  // asks `medicaidEligibility` for the per-state answer where the profile knows
  // the state — so there is no figure left in that prose to bind. A rate that is
  // read rather than typed is the outcome this sweep exists to push toward, so
  // the entry is removed rather than kept passing on a coincidence.
  {
    file: "tiles/owedScreener.ts",
    shard: "aca-2024",
    path: ".applicablePercentage.5.fplHigh",
    derive: asPoints,
  },
  {
    file: "tiles/medicaid.ts",
    shard: "medicaid-2024",
    path: ".expansionThresholdPctFpl",
    derive: asPoints,
  },
  {
    file: "tiles/medicaid.ts",
    shard: "medicaid-2024",
    path: ".thresholdOverridesPctFpl.DC",
    derive: asPoints,
    why: "DC's override, the one the Readout Report used to ignore",
  },

  {
    file: "tiles/garnishment.ts",
    shard: "garnishment-limits-2026",
    path: ".supportOrder.supportingOtherDependentsShare",
  },
  {
    file: "tiles/garnishment.ts",
    shard: "garnishment-limits-2026",
    path: ".supportOrder.notSupportingOtherDependentsShare",
  },

  { file: "tiles/giftTax.ts", shard: "gift-tax-2024", path: ".topRate" },

  { file: "tiles/saversCredit.ts", shard: "savers-credit-2024", path: ".tiers.0.rate" },
  { file: "tiles/saversCredit.ts", shard: "savers-credit-2024", path: ".tiers.1.rate" },
  { file: "tiles/saversCredit.ts", shard: "savers-credit-2024", path: ".tiers.2.rate" },

  {
    file: "tiles/snap.ts",
    shard: "snap-fy2024-contiguous",
    path: ".grossIncomeLimitPctFpl",
    derive: asPoints,
  },
  {
    file: "tiles/snap.ts",
    shard: "snap-fy2024-contiguous",
    path: ".netIncomeLimitPctFpl",
    derive: asPoints,
  },
  { file: "tiles/snap.ts", shard: "snap-fy2024-contiguous", path: ".earnedIncomeDeductionRate" },
  { file: "tiles/snap.ts", shard: "snap-fy2024-contiguous", path: ".expectedContributionRate" },

  {
    file: "tiles/socialSecurity.ts",
    shard: "social-security-2024",
    path: [".delayedCreditPerMonthNumer", ".delayedCreditPerMonthDenom"],
    derive: (numer, denom) => (numer / denom) * 12,
    why: "the delayed-retirement credit a year, which the sentence states both ways",
  },

  {
    file: "tiles/socialSecurityTax.ts",
    shard: "social-security-taxation-2024",
    path: ".tier1InclusionRate",
  },
  {
    file: "tiles/socialSecurityTax.ts",
    shard: "social-security-taxation-2024",
    path: ".tier2InclusionRate",
  },

  { file: "tiles/takeHome.ts", shard: "fica-2024", path: ".socialSecurityRate" },
  { file: "tiles/takeHome.ts", shard: "fica-2024", path: ".medicareRate" },
  { file: "tiles/takeHome.ts", shard: "fica-2024", path: ".additionalMedicareRate" },

  // Both halves, doubled, in the tile about paying both halves.
  {
    file: "tiles/selfEmploymentTax.ts",
    shard: "fica-2024",
    path: ".socialSecurityRate",
    derive: (ss) => ss * 2 * 100,
    why: "both halves of Social Security",
  },
  {
    file: "tiles/selfEmploymentTax.ts",
    shard: "fica-2024",
    path: ".medicareRate",
    derive: (medicare) => medicare * 2 * 100,
    why: "both halves of Medicare",
  },
  { file: "tiles/selfEmploymentTax.ts", shard: "fica-2024", path: ".additionalMedicareRate" },
  {
    file: "tiles/selfEmploymentTax.ts",
    shard: "fica-2024",
    path: [".socialSecurityRate", ".medicareRate"],
    derive: (ss, medicare) => (ss + medicare) * 100,
    why: "what an employee sees, for the contrast the sentence draws",
  },
  {
    file: "tiles/selfEmploymentTax.ts",
    shard: "fica-2024",
    path: [".socialSecurityRate", ".medicareRate"],
    derive: (ss, medicare) => (ss + medicare) * 2 * 100,
    why: "the combined self-employment rate",
  },
  {
    file: "tiles/quarterlyTaxes.ts",
    shard: "fica-2024",
    path: [".socialSecurityRate", ".medicareRate"],
    derive: (ss, medicare) => (ss + medicare) * 2 * 100,
    why: "the same combined rate, in the tile that sets money aside for it",
  },

  // Rates the code owns by name rather than reading from a shard.
  {
    file: "tiles/federalIncomeTax.ts",
    constant: { name: "MEDICAL_AGI_FLOOR_RATE", in: "engine/tax/deductions.ts" },
    derive: (rate) => rate * 100,
  },
  {
    file: "tiles/selfEmploymentTax.ts",
    constant: { name: "SE_TAX_BASE_RATE", in: "engine/tax/fica.ts" },
    derive: (rate) => rate * 100,
  },
  {
    file: "tiles/quarterlyTaxes.ts",
    constant: { name: "SE_TAX_BASE_RATE", in: "engine/tax/fica.ts" },
    derive: (rate) => rate * 100,
  },
  // The three §6654(d)(1) multiples the safe-harbor sentence quotes. They are
  // the statute's own words and they are also what the engine multiplies by, so
  // the sentence and the arithmetic move together or not at all.
  {
    file: "tiles/quarterlyTaxes.ts",
    constant: { name: "CURRENT_YEAR_SHARE", in: "engine/dueDates.ts" },
    derive: (share) => share * 100,
    why: "90% of this year's own tax, §6654(d)(1)(B)(i)",
  },
  {
    file: "tiles/quarterlyTaxes.ts",
    constant: { name: "PRIOR_YEAR_SHARE", in: "engine/dueDates.ts" },
    derive: (share) => share * 100,
    why: "100% of last year's, §6654(d)(1)(B)(ii)",
  },
  {
    file: "tiles/quarterlyTaxes.ts",
    constant: { name: "PRIOR_YEAR_SHARE_HIGH_AGI", in: "engine/dueDates.ts" },
    derive: (share) => share * 100,
    why: "what subparagraph (C)(i) substitutes above the AGI line",
  },
  {
    file: "ui/ledgerView.ts",
    constant: { name: "MATERIAL_FLOOR_SHARE", in: "profile/ledger.ts" },
    derive: (share) => share * 100,
    why: "the other arm of the materiality floor, the dollar one bound in the figures sweep",
  },
  {
    file: "tiles/homeAffordability.ts",
    constant: { name: "HOUSING_RATIO", in: "tiles/homeAffordability.ts" },
    derive: (ratio) => ratio * 100,
  },
  {
    file: "tiles/homeAffordability.ts",
    constant: { name: "TOTAL_DEBT_RATIO", in: "tiles/homeAffordability.ts" },
    derive: (ratio) => ratio * 100,
  },
  {
    file: "tiles/selfEmployedRetirement.ts",
    constant: { name: "EMPLOYER_SHARE_RATE", in: "engine/contributionLimits.ts" },
    derive: (rate) => rate * 100,
  },
];

/**
 * A percentage in prose that is not a rate anybody sets: an illustration, a
 * rendered zero, a CSS width, a default the reader can change, the unit another
 * figure is quoted in. Each is written down so that a rate which IS legislated
 * cannot arrive unnoticed.
 */
const NOT_A_RATE: Record<string, Record<string, string>> = {
  "readout/report.ts": {
    "100%": "a table width in the report's own stylesheet",
    "60%": "a column width in the report's own stylesheet",
  },
  "tiles/acaPtc.ts": { "100%": "the poverty line itself, which is 100% by definition" },
  "tiles/fpl.ts": { "100%": "the poverty line itself, which is what this tile computes" },
  "tiles/balanceTransfer.ts": {
    "0%": "the intro APR a card advertises, which the reader enters",
    "3%": "a typical transfer fee, named as typical",
  },
  "ui/statuteStep.ts": {
    // Same shape as the cliff tile's below: the sentence names the point a
    // combined marginal rate can pass, not a rate any statute sets. Ohio's $332
    // step at $26,050 puts a filer $50 under the line at 351%, measured over a
    // $100 probe, and the sentence explains that rather than leaving the number
    // looking like a broken calculator. It lives here, shared by the Take-Home
    // tile and the Readout Report, so the document cannot drift from the tile.
    "100%": "the point a combined rate can exceed, which is arithmetic and not a rate anyone sets",
  },
  "tiles/benefitCliffs.ts": {
    "100%": "the point a combined rate can exceed, which is arithmetic and not a rate anyone sets",
  },
  "tiles/billTriage.ts": { "24%": "an illustrative card APR in the explainer" },
  "ui/shell.ts": { "24%": "the same illustrative card APR, in the getting-started guidance" },
  "tiles/childTax.ts": { "0%": "what is rendered when the computed rate is zero" },
  "tiles/saversCredit.ts": { "0%": "what is rendered above the income limit" },
  "tiles/socialSecurityTax.ts": { "0%": "what is rendered when none of the benefit is taxable" },
  "tiles/disability.ts": {
    "60%": "what group long-term disability typically replaces, named as typical",
  },
  "tiles/downshift.ts": { "5%": "the top of an illustrative real-return range" },
  "tiles/drawdown.ts": {
    "4%": "the withdrawal rule the tile is searched by, and the worked example's real return",
    "7%": "an illustrative nominal return in the same sentence",
    "3%": "the illustrative inflation subtracted from it",
  },
  "tiles/peaceOfMind.ts": { "4%": "an illustrative safe-withdrawal rate, shown as ≈ 25×" },
  "tiles/quarterlyTaxes.ts": {
    "20%": "the QBI deduction, named in the sentence saying it is NOT subtracted",
  },
  "tiles/selfEmployedRetirement.ts": {
    // Not a figure that can drift. §415(c)(1)(B) caps annual additions at "100
    // percent of the participant's compensation" — the whole of it, which is
    // the one quantity a statute cannot index. Binding it to a `const` set to
    // 1 would dress a tautology up as a watched number.
    "100%": "the §415(c)(1)(B) limb, which is the whole of compensation by statute",
  },
  "tiles/socialSecurity.ts": {
    "1%": "the unit the SSA quotes its reduction fractions in — 5/9 of 1% a month",
  },
  "tiles/spendingPlan.ts": {
    "50%": "the default split, which the reader changes with a preset or a field",
    "30%": "the default split, which the reader changes with a preset or a field",
    "20%": "what is left of it, computed rather than set",
  },
};

describe("a rate in the prose is the rate in the code", () => {
  const files = srcModules();
  const source = new Map(files.map((f) => [f, readerSource(f)] as const));

  const valueOf = (b: RateBound): number => {
    const values = b.constant
      ? [declaredConstant(b.constant.in, b.constant.name)]
      : (Array.isArray(b.path) ? b.path : [b.path!]).map((p) => shardNumber(b.shard!, p));
    return b.derive ? b.derive(...values) : values[0]! * 100;
  };

  for (const b of BOUND) {
    const rate = asRate(valueOf(b));
    const from = b.constant ? b.constant.name : `${b.shard}${b.path}`;
    it(`${b.file} states ${rate}${b.why ? ` — ${b.why}` : ` for ${from}`}`, () => {
      expect(statesRate(source.get(b.file)!, rate), `${b.file} does not state ${rate}`).toBe(true);
    });
  }

  it("accounts for every percentage in every module", () => {
    const unaccounted: string[] = [];
    for (const [file, text] of source) {
      const bound = new Set(BOUND.filter((b) => b.file === file).map((b) => asRate(valueOf(b))));
      const allowed = NOT_A_RATE[file] ?? {};
      for (const rate of proseRates(text)) {
        if (!bound.has(rate) && !(rate in allowed)) unaccounted.push(`${file} ${rate}`);
      }
    }
    expect(
      unaccounted.sort(),
      "bind it to the shard field or constant it mirrors, or say in NOT_A_RATE why it is not one",
    ).toEqual([]);
  });

  it("every entry in NOT_A_RATE is a rate that is really there", () => {
    const dead: string[] = [];
    for (const [file, allowed] of Object.entries(NOT_A_RATE)) {
      const text = source.get(file);
      if (!text) {
        dead.push(`${file} (no such module)`);
        continue;
      }
      const found = new Set(proseRates(text));
      for (const rate of Object.keys(allowed)) if (!found.has(rate)) dead.push(`${file} ${rate}`);
    }
    expect(dead.sort(), "delete the entry, or fix the rate it was written for").toEqual([]);
  });

  it("writes a rate the way the prose does", () => {
    expect(asRate(6.2)).toBe("6.2%");
    expect(asRate(1.45)).toBe("1.45%");
    expect(asRate(100)).toBe("100%");
    // The reason this rounds at all: a fraction times 100 is not the number a
    // person wrote. 0.009 * 100 is 0.9000000000000001 in binary floating point,
    // and comparing that against "0.9%" reports a rate plainly on the page as
    // missing — the one answer these sweeps must never give.
    expect(asRate(0.009 * 100)).toBe("0.9%");
    expect(asRate((0.062 + 0.0145) * 2 * 100)).toBe("15.3%");
  });

  it("does not find a rate inside a longer one", () => {
    expect(statesRate("at or below 138% of the line", "38%")).toBe(false);
    expect(statesRate("the 3.8% surtax", "8%")).toBe(false);
    expect(statesRate("the 3.8% surtax", "3.8%")).toBe(true);
    expect(statesRate("a 20% credit", "20%")).toBe(true);
  });

  it("reads only what a reader sees", () => {
    // Same rule as the figures sweep: the comment explaining that a rate used
    // to be 5% is not a claim on anyone's screen.
    expect(proseRates('// was 5%\nconst a = "the 20% credit";')).toEqual(["20%"]);
  });
});
