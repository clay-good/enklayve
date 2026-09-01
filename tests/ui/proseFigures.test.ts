import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A dollar figure written into a tile's explainer says the same thing as the
 * shard the tile computes from.
 *
 * Prose goes stale exactly the way a constant does, and it is worse when it
 * does, because the number the reader is told and the number the calculator
 * uses are then both on the same screen disagreeing. Two of these were live on
 * 2026-09-01, both from the One Big Beautiful Bill Act:
 *
 *   - the federal income tax explainer said state and local taxes were "capped
 *     at $10,000" while the engine had been fixed to the statute's $40,400
 *   - the Child Tax Credit explainer said "$2,000 per qualifying child" while
 *     the shard had carried $2,200 since the Act, so the tile computed $2,200
 *     and the paragraph beneath it said $2,000
 *
 * Neither was a hard failure anywhere. Nothing compares a sentence to a shard.
 *
 * So the figures below are read back out of the shard at test time, and a tile
 * that states a statutory amount has to state the one it computes with. The
 * completeness half matters as much: within these files, EVERY dollar figure is
 * either bound here or listed as not a figure at all, so a new one cannot be
 * added silently. Scoped to the files that quote statutory amounts — a tile
 * whose only "$1,000" is "what your next $1,000 of income costs" has nothing to
 * bind.
 */
const ROOT = resolve(__dirname, "..", "..");

const shard = (id: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(ROOT, "data", `${id}.json`), "utf8")) as Record<string, unknown>;

function at(id: string, path: string): number {
  const value = path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], shard(id));
  expect(typeof value, `${id}${path} is not a number`).toBe("number");
  return value as number;
}

/**
 * The way these figures are written in prose: `$1,350`, `$7.25`, `$15,000,000`.
 *
 * Cents are all-or-nothing. `maximumFractionDigits` alone renders 217.5 as
 * "$217.5", which is a substring of the "$217.50" on the page — so the check
 * passed while comparing the wrong string, which is the exact shape of bug this
 * file exists to catch.
 */
export function asProse(value: number): string {
  const digits = Number.isInteger(value) ? 0 : 2;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/**
 * Every dollar figure a READER could see: the strings, not the comments.
 *
 * The scan read whole files, so the sentence in this module's own header
 * explaining that the Child Tax Credit explainer once said $2,000 while the
 * tile computed $2,200 registered as two unbound statutory figures. A number in
 * a comment is not on anyone's screen.
 *
 * The money pattern also has to end on a digit. `[0-9,]*` is greedy and ate the
 * comma after "over $75,000, or", producing "$75,000," — which matches no shard
 * value and would have been silenced by writing it into the not-a-figure list,
 * the wrong fix for a broken pattern.
 */
export function proseFigures(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
  return [...new Set(withoutComments.match(/\$\d{1,3}(?:,\d{3})*(?:\.\d+)?/g) ?? [])];
}

/**
 * `$25,000` must not be found inside `$25,000,000`, and `$217.5` must not be
 * found inside `$217.50`. A containment test on money is a containment test on
 * a prefix unless the next character is ruled out.
 */
export function statesFigure(text: string, prose: string): boolean {
  // Ruling out a following comma outright was too much: prose writes "over
  // $75,000, or $150,000 on a joint return", and a comma that ends a clause is
  // not a thousands separator. What disqualifies a match is a digit after it, a
  // decimal point, or a comma with three digits behind it.
  return new RegExp(`${prose.replace(/[$.]/g, "\\$&")}(?![\\d.]|,\\d)`).test(text);
}

interface Bound {
  file: string;
  shard: string;
  /** Dotted path into the shard, or a function of it for a derived figure. */
  path: string;
  derive?: (n: number) => number;
  why?: string;
}

const BOUND: Bound[] = [
  { file: "childTax.ts", shard: "child-tax-2024", path: ".dependentStandardDeductionBase" },

  { file: "childTaxCredit.ts", shard: "eitc-ctc-2024", path: ".childTaxCredit.perChild" },
  { file: "childTaxCredit.ts", shard: "eitc-ctc-2024", path: ".childTaxCredit.refundableCap" },
  {
    file: "childTaxCredit.ts",
    shard: "eitc-ctc-2024",
    path: ".childTaxCredit.phaseOutPerThousand",
  },
  {
    file: "childTaxCredit.ts",
    shard: "eitc-ctc-2024",
    path: ".childTaxCredit.phaseOutThresholdSingle",
  },
  {
    file: "childTaxCredit.ts",
    shard: "eitc-ctc-2024",
    path: ".childTaxCredit.phaseOutThresholdMarried",
  },

  { file: "educationCredits.ts", shard: "education-credits-2024", path: ".aotc.maxCredit" },
  { file: "educationCredits.ts", shard: "education-credits-2024", path: ".llc.expenseCap" },
  { file: "educationCredits.ts", shard: "education-credits-2024", path: ".llc.maxCredit" },
  { file: "educationCredits.ts", shard: "education-credits-2024", path: ".phaseOut.single.low" },
  { file: "educationCredits.ts", shard: "education-credits-2024", path: ".phaseOut.single.high" },
  { file: "educationCredits.ts", shard: "education-credits-2024", path: ".phaseOut.married.low" },
  { file: "educationCredits.ts", shard: "education-credits-2024", path: ".phaseOut.married.high" },

  // Every one of these is inflation-indexed, so they move every single year.
  { file: "giftTax.ts", shard: "gift-tax-2024", path: ".annualExclusion" },
  { file: "giftTax.ts", shard: "gift-tax-2024", path: ".annualExclusionNonCitizenSpouse" },
  { file: "giftTax.ts", shard: "gift-tax-2024", path: ".lifetimeExemption" },

  { file: "garnishment.ts", shard: "garnishment-limits-2026", path: ".federalMinimumHourlyWage" },
  {
    file: "garnishment.ts",
    shard: "garnishment-limits-2026",
    path: ".federalMinimumHourlyWage",
    derive: (n) => n * 30,
    why: "the protected floor, thirty times the minimum wage (15 U.S.C. §1673(a)(2))",
  },
  {
    file: "garnishment.ts",
    shard: "garnishment-limits-2026",
    path: ".federalMinimumHourlyWage",
    derive: (n) => (n * 30) / 0.75,
    why: "where the two federal tests cross, so the prose cannot drift from either one",
  },

  {
    file: "socialSecurityTax.ts",
    shard: "social-security-taxation-2024",
    path: ".base1ByFilingStatus.single",
  },
  {
    file: "socialSecurityTax.ts",
    shard: "social-security-taxation-2024",
    path: ".base2ByFilingStatus.single",
  },
  {
    file: "socialSecurityTax.ts",
    shard: "social-security-taxation-2024",
    path: ".base1ByFilingStatus.married_jointly",
  },
  {
    file: "socialSecurityTax.ts",
    shard: "social-security-taxation-2024",
    path: ".base2ByFilingStatus.married_jointly",
  },

  {
    file: "federalIncomeTax.ts",
    shard: "federal-income-tax-2024",
    path: ".saltLimitation.applicableLimitationAmount",
  },
  {
    file: "federalIncomeTax.ts",
    shard: "federal-income-tax-2024",
    path: ".saltLimitation.thresholdAmount",
  },
  { file: "federalIncomeTax.ts", shard: "federal-income-tax-2024", path: ".saltLimitation.floor" },

  {
    file: "deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".nonItemizerCharitable.cap",
  },
  {
    file: "deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".nonItemizerCharitable.capJointReturn",
  },
  {
    file: "deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".seniorDeduction.perQualifiedIndividual",
  },
  {
    file: "deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".seniorDeduction.thresholdSingle",
  },
  {
    file: "deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".seniorDeduction.thresholdJointReturn",
  },
  {
    file: "deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".qualifiedTipsDeduction.cap",
  },
  {
    file: "deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".qualifiedOvertimeDeduction.cap",
  },
  {
    file: "deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".qualifiedOvertimeDeduction.capJointReturn",
  },
  {
    file: "deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".qualifiedTipsDeduction.phaseOutPerStep",
  },
  {
    file: "deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".qualifiedTipsDeduction.phaseOutStep",
  },
  {
    file: "deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".qualifiedTipsDeduction.thresholdJointReturn",
  },
  {
    file: "deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".vehicleLoanInterestDeduction.cap",
  },
  // The Auto Loan tile names §163(h)(4) too, because it is the tile that
  // computes the interest the deduction is measured on. A second file quoting
  // the same three figures is a second place for them to go stale, so it joins
  // the check rather than being trusted.
  {
    file: "autoLoan.ts",
    shard: "federal-income-tax-2024",
    path: ".vehicleLoanInterestDeduction.cap",
  },
  {
    file: "autoLoan.ts",
    shard: "federal-income-tax-2024",
    path: ".vehicleLoanInterestDeduction.thresholdSingle",
  },
  {
    file: "autoLoan.ts",
    shard: "federal-income-tax-2024",
    path: ".vehicleLoanInterestDeduction.thresholdJointReturn",
  },
  {
    file: "deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".vehicleLoanInterestDeduction.phaseOutPerStep",
  },
  {
    file: "deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".vehicleLoanInterestDeduction.thresholdSingle",
  },
  {
    file: "deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".vehicleLoanInterestDeduction.thresholdJointReturn",
  },

  { file: "saversCredit.ts", shard: "savers-credit-2024", path: ".maxContributionPerPerson" },
  {
    file: "saversCredit.ts",
    shard: "savers-credit-2024",
    path: ".maxContributionPerPerson",
    derive: (n) => n * 2,
    why: "the joint cap, twice the per-person one",
  },
];

/**
 * A statutory figure that is a constant in code rather than a shard field, and
 * so is bound to the constant instead. Only §1211(b)'s offset limit qualifies:
 * $3,000 since the Revenue Act of 1978, never indexed, with the reasoning for
 * leaving it in code recorded in the numeric-constant sweep.
 */
const BOUND_TO_CODE: { file: string; figure: string; from: string }[] = [
  { file: "taxLossHarvesting.ts", figure: "$3,000", from: "LOSS_OFFSET_LIMIT" },
  { file: "taxLossHarvesting.ts", figure: "$1,500", from: "LOSS_OFFSET_LIMIT_SEPARATE" },
];

/**
 * Dollar figures in these same files that are not statutory amounts: an
 * illustrative sum, a step size, a rounding unit, a UI default. Each is here so
 * that a figure which IS statutory cannot arrive unnoticed.
 */
const NOT_A_FIGURE: Record<string, Record<string, string>> = {
  "deductionCopy.ts": {
    // Where §163(h)(4)'s joint phase-out lands, which is the threshold plus the
    // cap divided by the step: $200,000 + $10,000 ÷ $200 × $1,000. Every term is
    // bound above, so the sentence cannot drift without one of them moving; the
    // arithmetic is stated for the reader rather than being a fifth field.
    "$250,000": "where the joint phase-out ends, derived from four bound fields",
  },
  "childTaxCredit.ts": { "$1,000": "the per-$1,000 step the phase-out is quoted in" },
  "federalIncomeTax.ts": { "$1,000": "an illustrative next-dollar amount" },
  "socialSecurityTax.ts": {
    $0: "the married-filing-separately special case, called out as omitted",
    $25: "the same base in $k shorthand in a code comment",
    $32: "the same base in $k shorthand in a code comment",
    $34: "the same base in $k shorthand in a code comment",
    $44: "the same base in $k shorthand in a code comment",
  },
  "educationCredits.ts": { "$2,000,": "the LLC cap again, with a trailing comma" },
};

describe("a figure in the prose is the figure in the shard", () => {
  const files = [
    ...new Set([
      ...BOUND.map((b) => b.file),
      ...BOUND_TO_CODE.map((b) => b.file),
      ...Object.keys(NOT_A_FIGURE),
    ]),
  ];
  const source = new Map(
    files.map((f) => [f, readFileSync(resolve(ROOT, "src", "tiles", f), "utf8")] as const),
  );

  for (const b of BOUND) {
    const value = b.derive ? b.derive(at(b.shard, b.path)) : at(b.shard, b.path);
    const prose = asProse(value);
    it(`${b.file} states ${prose}${b.why ? ` — ${b.why}` : ` for ${b.shard}${b.path}`}`, () => {
      expect(
        statesFigure(source.get(b.file)!, prose),
        `${b.file} does not state ${prose}, which is ${b.shard}${b.path}` +
          (b.derive ? " (derived)" : ""),
      ).toBe(true);
    });
  }

  for (const b of BOUND_TO_CODE) {
    it(`${b.file} states ${b.figure}, the value of ${b.from}`, () => {
      const text = source.get(b.file)!;
      const declared = new RegExp(`const ${b.from} = (\\d+);`).exec(text);
      expect(declared, `${b.from} is not declared in ${b.file}`).not.toBeNull();
      expect(asProse(Number(declared![1]))).toBe(b.figure);
      expect(statesFigure(text, b.figure), `${b.file} does not state ${b.figure}`).toBe(true);
    });
  }

  it("accounts for every dollar figure in those files", () => {
    const unaccounted: string[] = [];
    for (const [file, text] of source) {
      const bound = new Set(
        BOUND.filter((b) => b.file === file).map((b) =>
          asProse(b.derive ? b.derive(at(b.shard, b.path)) : at(b.shard, b.path)),
        ),
      );
      for (const b of BOUND_TO_CODE.filter((x) => x.file === file)) bound.add(b.figure);
      const allowed = NOT_A_FIGURE[file] ?? {};
      for (const m of proseFigures(text)) {
        if (!bound.has(m) && !(m in allowed)) unaccounted.push(`${file} ${m}`);
      }
    }
    expect(
      unaccounted.sort(),
      "bind it to the shard field it mirrors, or say in NOT_A_FIGURE why it is not one",
    ).toEqual([]);
  });

  it("no longer says the Child Tax Credit is $2,000", () => {
    // The live case. The shard has carried $2,200 since the One Big Beautiful
    // Bill Act, so the tile computed $2,200 under a paragraph saying $2,000.
    expect(source.get("childTaxCredit.ts")).not.toContain("$2,000");
  });

  it("reads the strings and not the comments", () => {
    expect(proseFigures('/** was $2,000 */\nconst a = "pay $1,500 now";')).toEqual(["$1,500"]);
    expect(proseFigures('// $9,000\nconst b = "$25";')).toEqual(["$25"]);
  });

  it("ends a figure on a digit, not on the comma after it", () => {
    expect(proseFigures('"over $75,000, or $150,000 on a joint return"')).toEqual([
      "$75,000",
      "$150,000",
    ]);
  });

  it("writes a figure the way the prose does", () => {
    expect(asProse(1350)).toBe("$1,350");
    expect(asProse(7.25)).toBe("$7.25");
    expect(asProse(217.5)).toBe("$217.50");
    expect(asProse(15_000_000)).toBe("$15,000,000");
  });

  it("does not find a figure inside a longer one", () => {
    expect(statesFigure("a $25,000,000 estate", "$25,000")).toBe(false);
    expect(statesFigure("the $217.50 floor", "$217.5")).toBe(false);
    expect(statesFigure("the $217.50 floor", "$217.50")).toBe(true);
    expect(statesFigure("capped at $40,400 for 2026", "$40,400")).toBe(true);
    // A comma that ends a clause is not a thousands separator.
    expect(statesFigure("over $75,000, or $150,000 jointly", "$75,000")).toBe(true);
  });
});
