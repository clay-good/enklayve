import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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

/** Every `.ts` module under `src/`, as a path relative to it. */
function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(resolve(dir, entry.name), rel));
    else if (entry.name.endsWith(".ts")) out.push(rel);
  }
  return out.sort();
}

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
 *
 * And `$1M` is not `$1`. The umbrella tile rounds up to "the $1M layer umbrella
 * is sold in" and the scan reported a one-dollar figure, the same shape as
 * `$217.5` inside `$217.50`: a prefix read as an amount. A magnitude suffix
 * disqualifies the match rather than being written down as not-a-figure, for
 * the same reason as the greedy comma — the pattern is wrong, not the prose.
 */
export function proseFigures(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    // A comment that TRAILS code is not on anyone's screen either, and only
    // whole-line ones were being dropped: `w4Withholding.ts` was carrying a
    // `$100` from `// within ~$100 for the year`. The `//` has to be preceded
    // by whitespace, a bracket or a semicolon so that the one in `https://`,
    // which follows a colon, is left alone.
    .replace(/(^|[\s;{}()[\]])\/\/[^\n]*/g, "$1 ");
  return [...new Set(withoutComments.match(/\$\d{1,3}(?:,\d{3})*(?:\.\d+)?(?![\dMBk])/g) ?? [])];
}

/**
 * `$25,000` must not be found inside `$25,000,000`, and `$217.5` must not be
 * found inside `$217.50`. A containment test on money is a containment test on
 * a prefix unless the next character is ruled out.
 */
export function statesFigure(text: string, prose: string): boolean {
  // Ruling out a following comma outright was too much: prose writes "over
  // $75,000, or $150,000 on a joint return", and a comma that ends a clause is
  // not a thousands separator. The same was true of the full stop, and it took
  // longer to notice: rejecting any following "." rejected every figure that
  // ENDS A SENTENCE — "the SAI can be as low as -$1,500." — reporting a figure
  // plainly present as absent, which is the one answer this helper must never
  // give. What disqualifies a match is a digit after it, a decimal point
  // followed by a digit, or a comma with three digits behind it.
  return new RegExp(`${prose.replace(/[$.]/g, "\\$&")}(?!\\d|\\.\\d|,\\d)`).test(text);
}

interface Bound {
  file: string;
  shard: string;
  /** Dotted path into the shard, or a function of it for a derived figure. */
  path: string;
  derive?: (n: number) => number;
  why?: string;
}

describe("the containment test on money", () => {
  it("rejects a prefix of a longer figure", () => {
    expect(statesFigure("we cap it at $25,000,000 in total", "$25,000")).toBe(false);
    expect(statesFigure("the fee is $217.50", "$217.5")).toBe(false);
  });

  it("accepts a figure that ends a sentence", () => {
    // It did not, and that is the failure worth a case: rejecting any following
    // "." rejected every figure at the end of a sentence and reported it as
    // absent. A checker that says a figure is missing when it is right there
    // teaches people to stop believing it.
    expect(statesFigure("the SAI can be as low as -$1,500.", "$1,500")).toBe(true);
    expect(statesFigure("you may deduct $10,000.", "$10,000")).toBe(true);
  });

  it("still accepts a figure before a clause comma", () => {
    expect(statesFigure("over $75,000, or $150,000 jointly", "$75,000")).toBe(true);
  });
});

const BOUND: Bound[] = [
  { file: "tiles/childTax.ts", shard: "child-tax-2024", path: ".dependentStandardDeductionBase" },

  { file: "tiles/childTaxCredit.ts", shard: "eitc-ctc-2024", path: ".childTaxCredit.perChild" },
  {
    file: "tiles/childTaxCredit.ts",
    shard: "eitc-ctc-2024",
    path: ".childTaxCredit.refundableCap",
  },
  {
    file: "tiles/childTaxCredit.ts",
    shard: "eitc-ctc-2024",
    path: ".childTaxCredit.phaseOutPerThousand",
  },
  {
    file: "tiles/childTaxCredit.ts",
    shard: "eitc-ctc-2024",
    path: ".childTaxCredit.phaseOutThresholdSingle",
  },
  {
    file: "tiles/childTaxCredit.ts",
    shard: "eitc-ctc-2024",
    path: ".childTaxCredit.phaseOutThresholdMarried",
  },

  { file: "tiles/educationCredits.ts", shard: "education-credits-2024", path: ".aotc.maxCredit" },
  { file: "tiles/educationCredits.ts", shard: "education-credits-2024", path: ".llc.expenseCap" },
  { file: "tiles/educationCredits.ts", shard: "education-credits-2024", path: ".llc.maxCredit" },
  {
    file: "tiles/educationCredits.ts",
    shard: "education-credits-2024",
    path: ".phaseOut.single.low",
  },
  {
    file: "tiles/educationCredits.ts",
    shard: "education-credits-2024",
    path: ".phaseOut.single.high",
  },
  {
    file: "tiles/educationCredits.ts",
    shard: "education-credits-2024",
    path: ".phaseOut.married.low",
  },
  {
    file: "tiles/educationCredits.ts",
    shard: "education-credits-2024",
    path: ".phaseOut.married.high",
  },

  // Every one of these is inflation-indexed, so they move every single year.
  { file: "tiles/giftTax.ts", shard: "gift-tax-2024", path: ".annualExclusion" },
  { file: "tiles/giftTax.ts", shard: "gift-tax-2024", path: ".annualExclusionNonCitizenSpouse" },
  { file: "tiles/giftTax.ts", shard: "gift-tax-2024", path: ".lifetimeExemption" },

  {
    file: "tiles/garnishment.ts",
    shard: "garnishment-limits-2026",
    path: ".federalMinimumHourlyWage",
  },
  {
    file: "tiles/garnishment.ts",
    shard: "garnishment-limits-2026",
    path: ".federalMinimumHourlyWage",
    derive: (n) => n * 30,
    why: "the protected floor, thirty times the minimum wage (15 U.S.C. §1673(a)(2))",
  },
  {
    file: "tiles/garnishment.ts",
    shard: "garnishment-limits-2026",
    path: ".federalMinimumHourlyWage",
    derive: (n) => (n * 30) / 0.75,
    why: "where the two federal tests cross, so the prose cannot drift from either one",
  },

  {
    file: "tiles/socialSecurityTax.ts",
    shard: "social-security-taxation-2024",
    path: ".base1ByFilingStatus.single",
  },
  {
    file: "tiles/socialSecurityTax.ts",
    shard: "social-security-taxation-2024",
    path: ".base2ByFilingStatus.single",
  },
  {
    file: "tiles/socialSecurityTax.ts",
    shard: "social-security-taxation-2024",
    path: ".base1ByFilingStatus.married_jointly",
  },
  {
    file: "tiles/socialSecurityTax.ts",
    shard: "social-security-taxation-2024",
    path: ".base2ByFilingStatus.married_jointly",
  },

  {
    file: "tiles/federalIncomeTax.ts",
    shard: "federal-income-tax-2024",
    path: ".saltLimitation.applicableLimitationAmount",
  },
  {
    file: "tiles/federalIncomeTax.ts",
    shard: "federal-income-tax-2024",
    path: ".saltLimitation.thresholdAmount",
  },
  {
    file: "tiles/federalIncomeTax.ts",
    shard: "federal-income-tax-2024",
    path: ".saltLimitation.floor",
  },

  {
    file: "tiles/deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".nonItemizerCharitable.cap",
  },
  {
    file: "tiles/deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".nonItemizerCharitable.capJointReturn",
  },
  {
    file: "tiles/deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".seniorDeduction.perQualifiedIndividual",
  },
  {
    file: "tiles/deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".seniorDeduction.thresholdSingle",
  },
  {
    file: "tiles/deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".seniorDeduction.thresholdJointReturn",
  },
  {
    file: "tiles/deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".qualifiedTipsDeduction.cap",
  },
  {
    file: "tiles/deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".qualifiedOvertimeDeduction.cap",
  },
  {
    file: "tiles/deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".qualifiedOvertimeDeduction.capJointReturn",
  },
  {
    file: "tiles/deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".qualifiedTipsDeduction.phaseOutPerStep",
  },
  {
    file: "tiles/deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".qualifiedTipsDeduction.phaseOutStep",
  },
  {
    file: "tiles/deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".qualifiedTipsDeduction.thresholdJointReturn",
  },
  {
    file: "tiles/deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".vehicleLoanInterestDeduction.cap",
  },
  // The Auto Loan tile names §163(h)(4) too, because it is the tile that
  // computes the interest the deduction is measured on. A second file quoting
  // the same three figures is a second place for them to go stale, so it joins
  // the check rather than being trusted.
  {
    file: "tiles/autoLoan.ts",
    shard: "federal-income-tax-2024",
    path: ".vehicleLoanInterestDeduction.cap",
  },
  // The §530A tile quotes both of its shard's figures in the explainer, which
  // is exactly what this check exists for — and it shipped this morning without
  // being bound, by the person who had spent the day binding everything else.
  {
    file: "tiles/trumpAccount.ts",
    shard: "trump-accounts-2026",
    path: ".annualContributionLimit",
  },
  {
    file: "tiles/trumpAccount.ts",
    shard: "trump-accounts-2026",
    path: ".pilotContribution",
  },
  {
    file: "tiles/autoLoan.ts",
    shard: "federal-income-tax-2024",
    path: ".vehicleLoanInterestDeduction.thresholdSingle",
  },
  {
    file: "tiles/autoLoan.ts",
    shard: "federal-income-tax-2024",
    path: ".vehicleLoanInterestDeduction.thresholdJointReturn",
  },
  {
    file: "tiles/deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".vehicleLoanInterestDeduction.phaseOutPerStep",
  },
  {
    file: "tiles/deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".vehicleLoanInterestDeduction.thresholdSingle",
  },
  {
    file: "tiles/deductionCopy.ts",
    shard: "federal-income-tax-2024",
    path: ".vehicleLoanInterestDeduction.thresholdJointReturn",
  },

  // The SAI floor, quoted in the FAFSA tile's explainer as "-$1,500" and bound
  // by its magnitude: the prose carries the sign in a minus before the dollar
  // sign, which is where a reader expects it and where the figure pattern does
  // not look. Same class as the §530A pair — a shard figure in a sentence that
  // nothing compared.
  {
    file: "tiles/fafsaSai.ts",
    shard: "fafsa-2024-2025",
    path: ".saiFloor",
    derive: (n) => Math.abs(n),
    why: "the floor is negative and the sentence writes the sign outside the amount",
  },
  { file: "tiles/saversCredit.ts", shard: "savers-credit-2024", path: ".maxContributionPerPerson" },
  {
    file: "tiles/saversCredit.ts",
    shard: "savers-credit-2024",
    path: ".maxContributionPerPerson",
    derive: (n) => n * 2,
    why: "the joint cap, twice the per-person one",
  },
];

/**
 * A statutory figure that is a constant in code rather than a shard field, and
 * so is bound to the constant instead. Each is a period or an unindexed amount
 * left in code deliberately, with the reasoning recorded in the numeric-constant
 * sweep — §1211(b)'s offset limit, $3,000 since the Revenue Act of 1978, and
 * §219(g)(2)(B)'s partial-deduction arithmetic, unmoved since 1976.
 *
 * `declaredIn` is where the constant lives when that is not the file quoting it:
 * the IRA Deduction tile's explainer describes the round-up and the floor, and
 * both constants are in the engine module that applies them.
 */
const BOUND_TO_CODE: { file: string; figure: string; from: string; declaredIn?: string }[] = [
  { file: "tiles/taxLossHarvesting.ts", figure: "$3,000", from: "LOSS_OFFSET_LIMIT" },
  { file: "tiles/taxLossHarvesting.ts", figure: "$1,500", from: "LOSS_OFFSET_LIMIT_SEPARATE" },
  {
    file: "tiles/iraDeduction.ts",
    figure: "$10",
    from: "IRA_PARTIAL_ROUNDING",
    declaredIn: "engine/iraDeduction.ts",
  },
  {
    file: "tiles/iraDeduction.ts",
    figure: "$200",
    from: "IRA_PARTIAL_MINIMUM",
    declaredIn: "engine/iraDeduction.ts",
  },
  // Not statutory — an assumption this site chose (SPEC-4-ledger §3.1) — but the
  // sentence and the comparison have to agree for the same reason: the view
  // told the reader "$25 or 1%" from a literal while the profile module held
  // the floor, and nothing compared them.
  {
    file: "ui/ledgerView.ts",
    figure: "$25",
    from: "MATERIAL_FLOOR_DOLLARS",
    declaredIn: "profile/ledger.ts",
  },
  // §6654(d)(1)(C)'s two AGI lines, quoted by the tile that applies them. The
  // tile used to own the $150,000 as a literal and did not know the $75,000
  // existed at all, which is exactly the drift this sweep is for: one of the
  // two numbers a separate filer needs was absent from the prose because it was
  // absent from the code.
  {
    file: "tiles/quarterlyTaxes.ts",
    figure: "$150,000",
    from: "SAFE_HARBOR_HIGH_AGI",
    declaredIn: "engine/dueDates.ts",
  },
  {
    file: "tiles/quarterlyTaxes.ts",
    figure: "$75,000",
    from: "SAFE_HARBOR_HIGH_AGI_SEPARATE",
    declaredIn: "engine/dueDates.ts",
  },
];

/**
 * Dollar figures anywhere in `src/` that are not statutory amounts: an
 * illustrative sum, a step size, a rounding unit, a UI default. Each is here so
 * that a figure which IS statutory cannot arrive unnoticed.
 *
 * An entry has to match a figure the sweep actually finds, or it is deleted —
 * see "every entry here is a figure that is really there". Six were dead: five
 * describing `socialSecurityTax.ts` numbers written in a whole-line comment,
 * which the scan had stopped reading long before, and one `"$2,000,"` left from
 * the greedy-comma pattern that no longer produces it. A stale allowlist is the
 * quiet kind of hole — it grants a pass to a figure nobody has looked at, and
 * a real `$25` arriving in that tile's prose would have been waved through.
 */
const NOT_A_FIGURE: Record<string, Record<string, string>> = {
  "tiles/deductionCopy.ts": {
    // Where §163(h)(4)'s joint phase-out lands, which is the threshold plus the
    // cap divided by the step: $200,000 + $10,000 ÷ $200 × $1,000. Every term is
    // bound above, so the sentence cannot drift without one of them moving; the
    // arithmetic is stated for the reader rather than being a fifth field.
    "$250,000": "where the joint phase-out ends, derived from four bound fields",
    // The §170(b)(1)(I) floor is a RATE, not a dollar amount — the shard carries
    // 0.005 and nothing else. This is that rate worked through an illustrative
    // income, which is the only way to say what a floor costs a reader, and both
    // halves of the sentence move together if the rate ever does.
    $500: "0.5% of the illustrative $100,000 income in the same sentence",
  },
  "tiles/childTaxCredit.ts": { "$1,000": "the per-$1,000 step the phase-out is quoted in" },
  "tiles/federalIncomeTax.ts": { "$1,000": "an illustrative next-dollar amount" },
  // The same illustrative next-$1,000 sentence, in each tile that asks what a
  // raise or a dollar of income actually costs. It is the unit the answer is
  // quoted in, not an amount anyone legislates.
  "tiles/benefitCliffs.ts": { "$1,000": "the illustrative next dollars a cliff is quoted against" },
  "tiles/capitalGains.ts": { "$1,000": "an illustrative next-dollar amount, in a link's note" },
  "tiles/marginalExplorer.ts": {
    "$1,000": "the illustrative next-dollar amount the whole tile is about",
  },
  "tiles/paycheckOptimizer.ts": { "$1,000": "the illustrative next dollars into each account" },
  "readout/report.ts": { "$1,000": "the same illustrative next-dollar line, in the saved report" },
  "engine/cliffs.ts": {
    // The refundable Child Tax Credit's phase-in is shown at its cap, and this
    // is the earnings below which that reads high. It is a rounded "roughly",
    // deliberately, so it is not the arithmetic of any field.
    "$15,000": "a rounded 'roughly', in the disclosure of a modelling limit",
  },
};

describe("a figure in the prose is the figure in the shard", () => {
  // Every module under src/, not the ones already listed here. Scoping the
  // sweep to the files that had a binding meant a file could quote a statutory
  // amount and never be looked at — the completeness half was complete only
  // about itself. Reading the tiles directory found the IRA Deduction Checker's
  // explainer, which states §219(g)(2)(B)'s round-up and floor; reading the rest
  // of src/ found the ledger view's materiality sentence, which states the
  // dollar arm of a floor the profile module owns.
  //
  // A tile is not the only thing with prose. The Readout Report is a document a
  // household saves, the ledger view explains what it treats as news, and the
  // cliff engine writes its own disclosures — all of it on somebody's screen.
  const files = walk(resolve(ROOT, "src"));
  const source = new Map(
    files.map((f) => [f, readFileSync(resolve(ROOT, "src", f), "utf8")] as const),
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
      const where = b.declaredIn ?? b.file;
      const declaredIn = readFileSync(resolve(ROOT, "src", where), "utf8");
      // `[\\d_]` rather than `\\d`: `150_000` is the same number as `150000`, and
      // without the separator here the binding fails as "is not declared in",
      // which reads as a missing constant rather than an underscore.
      const declared = new RegExp(`const ${b.from} = ([\\d_]+);`).exec(declaredIn);
      expect(declared, `${b.from} is not declared in ${where}`).not.toBeNull();
      expect(asProse(Number(declared![1]!.replace(/_/g, "")))).toBe(b.figure);
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

  it("every entry here is a figure that is really there", () => {
    // An allowlist entry that matches nothing is not harmless. It reads as a
    // decision somebody made about a figure on the page, and it silently
    // permits that figure to appear later without anyone looking at it.
    const dead: string[] = [];
    for (const [file, allowed] of Object.entries(NOT_A_FIGURE)) {
      const text = source.get(file);
      if (!text) {
        dead.push(`${file} (no such tile)`);
        continue;
      }
      const found = new Set(proseFigures(text));
      for (const figure of Object.keys(allowed)) {
        if (!found.has(figure)) dead.push(`${file} ${figure}`);
      }
    }
    expect(dead.sort(), "delete the entry, or fix the figure it was written for").toEqual([]);
  });

  it("no longer says the Child Tax Credit is $2,000", () => {
    // The live case. The shard has carried $2,200 since the One Big Beautiful
    // Bill Act, so the tile computed $2,200 under a paragraph saying $2,000.
    expect(source.get("tiles/childTaxCredit.ts")!).not.toContain("$2,000");
  });

  it("reads the strings and not the comments", () => {
    expect(proseFigures('/** was $2,000 */\nconst a = "pay $1,500 now";')).toEqual(["$1,500"]);
    expect(proseFigures('// $9,000\nconst b = "$25";')).toEqual(["$25"]);
  });

  it("does not read a comment that trails code", () => {
    expect(proseFigures('const c = "$25"; // within ~$100 for the year')).toEqual(["$25"]);
    // The `//` in a URL follows a colon, and a URL is prose the reader can see.
    expect(proseFigures('const d = "https://x/$1,200";')).toEqual(["$1,200"]);
  });

  it("does not read $1M as one dollar", () => {
    expect(proseFigures('const e = "the $1M layer umbrella is sold in";')).toEqual([]);
    expect(proseFigures('const f = "$250k of coverage";')).toEqual([]);
    expect(proseFigures('const g = "$1,000,000 of coverage";')).toEqual(["$1,000,000"]);
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
