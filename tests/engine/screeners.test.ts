import { describe, it, expect, beforeAll } from "vitest";
import { iraDeductibility } from "../../src/engine/iraDeduction";
import { giftTaxImpact } from "../../src/engine/giftTax";
import { amtScreen } from "../../src/engine/amt";
import { estimatedTaxDueDates, formatDueDate } from "../../src/engine/dueDates";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import type { FilingStatus } from "../../src/data/schemas";

/**
 * SPEC-3 §4 next-wave screeners: the IRA-deductibility, gift-tax, and AMT engine
 * functions, plus the 1040-ES due-date calendar. Worked examples pin the cited
 * 2026 figures; the boundary sweep enforces the §2.9 invariants (finite results,
 * no throws over the adversarial input space).
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

const LIMITS = { ira_contribution: 7500, ira_catch_up_50plus: 1100 };
const baseIra = {
  filingStatus: "single" as FilingStatus,
  magi: 0,
  contribution: 7500,
  coveredByPlan: false,
  spouseCoveredByPlan: false,
  age50Plus: false,
};

describe("iraDeductibility (IRC §219(g), 2026)", () => {
  it("is fully deductible with no workplace-plan coverage, regardless of income", () => {
    const r = iraDeductibility({ ...baseIra, magi: 500000 }, LIMITS, data.iraDeduction()!);
    expect(r.status).toBe("no-limit");
    expect(r.deductible.toNumber()).toBe(7500);
    expect(r.nondeductibleBasis.toNumber()).toBe(0);
  });

  it("phases out linearly inside the single-covered range ($81k–$91k)", () => {
    const r = iraDeductibility(
      { ...baseIra, magi: 86000, coveredByPlan: true },
      LIMITS,
      data.iraDeduction()!,
    );
    // Halfway through the band → half the $7,500 limit = $3,750.
    expect(r.status).toBe("partial");
    expect(r.deductible.toNumber()).toBe(3750);
    expect(r.nondeductibleBasis.toNumber()).toBe(3750);
    expect(r.phaseOut).toEqual({ low: 81000, high: 91000 });
  });

  it("is fully deductible at or below the range, and none above it", () => {
    const full = iraDeductibility(
      { ...baseIra, magi: 70000, coveredByPlan: true },
      LIMITS,
      data.iraDeduction()!,
    );
    expect(full.status).toBe("full");
    expect(full.deductible.toNumber()).toBe(7500);
    const none = iraDeductibility(
      { ...baseIra, magi: 95000, coveredByPlan: true },
      LIMITS,
      data.iraDeduction()!,
    );
    expect(none.status).toBe("none");
    expect(none.deductible.toNumber()).toBe(0);
    expect(none.nondeductibleBasis.toNumber()).toBe(7500);
  });

  it("uses the higher spouse-covered range when only the spouse is covered (MFJ)", () => {
    const r = iraDeductibility(
      {
        ...baseIra,
        filingStatus: "married_jointly",
        magi: 245000,
        spouseCoveredByPlan: true,
      },
      LIMITS,
      data.iraDeduction()!,
    );
    expect(r.phaseOut).toEqual({ low: 242000, high: 252000 });
    // 70% of the way to the top → 0.7 × 7500 = 5250.
    expect(r.deductible.toNumber()).toBe(5250);
  });

  it("raises the limit with the age-50 catch-up", () => {
    const r = iraDeductibility(
      { ...baseIra, contribution: 8600, age50Plus: true },
      LIMITS,
      data.iraDeduction()!,
    );
    expect(r.contributionLimit.toNumber()).toBe(8600);
    expect(r.deductible.toNumber()).toBe(8600);
  });
});

describe("giftTaxImpact (IRC §2503(b), §2010, 2026)", () => {
  it("excludes the annual amount and routes the excess to the lifetime exemption", () => {
    const r = giftTaxImpact(
      {
        giftAmount: 50000,
        recipientIsSpouse: false,
        spouseIsUSCitizen: false,
        lifetimeExemptionUsed: 0,
      },
      data.giftTax()!,
    );
    expect(r.exclusionApplied.toNumber()).toBe(19000);
    expect(r.taxableGift.toNumber()).toBe(31000);
    expect(r.form709Required).toBe(true);
    expect(r.estimatedTaxDue.toNumber()).toBe(0);
    expect(r.lifetimeExemptionRemaining.toNumber()).toBe(15000000 - 31000);
  });

  it("needs no return for a gift within the annual exclusion", () => {
    const r = giftTaxImpact(
      {
        giftAmount: 10000,
        recipientIsSpouse: false,
        spouseIsUSCitizen: false,
        lifetimeExemptionUsed: 0,
      },
      data.giftTax()!,
    );
    expect(r.taxableGift.toNumber()).toBe(0);
    expect(r.form709Required).toBe(false);
  });

  it("applies the unlimited marital deduction for a US-citizen spouse", () => {
    const r = giftTaxImpact(
      {
        giftAmount: 1000000,
        recipientIsSpouse: true,
        spouseIsUSCitizen: true,
        lifetimeExemptionUsed: 0,
      },
      data.giftTax()!,
    );
    expect(r.maritalDeduction).toBe(true);
    expect(r.taxableGift.toNumber()).toBe(0);
    expect(r.form709Required).toBe(false);
  });

  it("uses the higher exclusion for a non-citizen spouse", () => {
    const r = giftTaxImpact(
      {
        giftAmount: 200000,
        recipientIsSpouse: true,
        spouseIsUSCitizen: false,
        lifetimeExemptionUsed: 0,
      },
      data.giftTax()!,
    );
    expect(r.annualExclusion.toNumber()).toBe(194000);
    expect(r.taxableGift.toNumber()).toBe(6000);
  });

  it("charges the 40% top rate only past the lifetime exemption", () => {
    const r = giftTaxImpact(
      {
        giftAmount: 100000,
        recipientIsSpouse: false,
        spouseIsUSCitizen: false,
        lifetimeExemptionUsed: 14990000,
      },
      data.giftTax()!,
    );
    // taxable 81,000 → used 15,071,000 → 71,000 over the $15M exemption → 40%.
    expect(r.taxableGift.toNumber()).toBe(81000);
    expect(r.estimatedTaxDue.toNumber()).toBeCloseTo(28400, 2);
    expect(r.lifetimeExemptionRemaining.toNumber()).toBe(-71000);
  });
});

describe("amtScreen (IRC §55, 2026)", () => {
  it("reports no AMT when income is under the exemption", () => {
    const r = amtScreen(
      { filingStatus: "single", amtIncome: 50000, regularTax: 4000 },
      data.amt()!,
    );
    expect(r.amtBase.toNumber()).toBe(0);
    expect(r.tentativeMinimumTax.toNumber()).toBe(0);
    expect(r.verdict).toBe("none");
  });

  it("computes the 26%/28% tentative minimum tax above the breakpoint", () => {
    const r = amtScreen(
      { filingStatus: "married_jointly", amtIncome: 580000, regularTax: 100000 },
      data.amt()!,
    );
    // exemption 140,200 (no phase-out under $1M); base 439,800; 26% to 244,500, 28% beyond.
    expect(r.exemption.toNumber()).toBe(140200);
    expect(r.amtBase.toNumber()).toBe(439800);
    expect(r.tentativeMinimumTax.toNumber()).toBeCloseTo(118254, 2);
    expect(r.amtOwed.toNumber()).toBeCloseTo(18254, 2);
    expect(r.verdict).toBe("likely");
  });

  it("phases the exemption out 25% above the threshold", () => {
    const r = amtScreen({ filingStatus: "single", amtIncome: 600000, regularTax: 0 }, data.amt()!);
    // (600,000 − 500,000) × 25% = 25,000 lost → exemption 65,100.
    expect(r.exemptionPhaseout.toNumber()).toBe(25000);
    expect(r.exemption.toNumber()).toBe(65100);
  });

  it("flags 'maybe' near the crossover and 'none' well below it", () => {
    const maybe = amtScreen(
      { filingStatus: "married_jointly", amtIncome: 580000, regularTax: 130000 },
      data.amt()!,
    );
    expect(maybe.amtOwed.toNumber()).toBe(0);
    expect(maybe.verdict).toBe("maybe");
    const none = amtScreen(
      { filingStatus: "married_jointly", amtIncome: 580000, regularTax: 200000 },
      data.amt()!,
    );
    expect(none.verdict).toBe("none");
  });
});

describe("estimatedTaxDueDates (1040-ES)", () => {
  it("returns the four statutory dates for 2026, none adjusted", () => {
    const d = estimatedTaxDueDates(2026);
    expect(d.map((x) => formatDueDate(x.due))).toEqual([
      "April 15, 2026",
      "June 15, 2026",
      "September 15, 2026",
      "January 15, 2027",
    ]);
    expect(d.every((x) => !x.adjusted)).toBe(true);
  });

  it("moves an April-15 weekend deadline past Emancipation Day (2023 → Apr 18)", () => {
    const d = estimatedTaxDueDates(2023);
    expect(formatDueDate(d[0]!.due)).toBe("April 18, 2023");
    expect(d[0]!.adjusted).toBe(true);
  });

  it("bumps a June-15 Saturday to the following Monday (2024)", () => {
    const d = estimatedTaxDueDates(2024);
    expect(formatDueDate(d[1]!.due)).toBe("June 17, 2024");
    expect(d[1]!.adjusted).toBe(true);
  });
});

describe("§2.9 boundary invariants — no screener throws or returns a non-finite figure", () => {
  const statuses: FilingStatus[] = [
    "single",
    "married_jointly",
    "married_separately",
    "head_of_household",
    "qualifying_surviving_spouse",
  ];
  const probes = [0, -1, 1, 1e9, 0.5, Number.MAX_SAFE_INTEGER];

  it("iraDeductibility stays finite over the boundary space", () => {
    for (const fs of statuses)
      for (const magi of probes)
        for (const c of probes)
          for (const cov of [true, false]) {
            const r = iraDeductibility(
              {
                filingStatus: fs,
                magi,
                contribution: c,
                coveredByPlan: cov,
                spouseCoveredByPlan: !cov,
                age50Plus: true,
              },
              LIMITS,
              data.iraDeduction()!,
            );
            expect(Number.isFinite(r.deductible.toNumber())).toBe(true);
            expect(r.deductible.toNumber()).toBeGreaterThanOrEqual(0);
            expect(Number.isFinite(r.nondeductibleBasis.toNumber())).toBe(true);
          }
  });

  it("giftTaxImpact and amtScreen stay finite over the boundary space", () => {
    for (const fs of statuses)
      for (const a of probes)
        for (const b of probes) {
          const g = giftTaxImpact(
            {
              giftAmount: a,
              recipientIsSpouse: b > 0,
              spouseIsUSCitizen: b < 1e9,
              lifetimeExemptionUsed: b,
            },
            data.giftTax()!,
          );
          expect(Number.isFinite(g.taxableGift.toNumber())).toBe(true);
          expect(Number.isFinite(g.estimatedTaxDue.toNumber())).toBe(true);
          const m = amtScreen({ filingStatus: fs, amtIncome: a, regularTax: b }, data.amt()!);
          expect(Number.isFinite(m.tentativeMinimumTax.toNumber())).toBe(true);
          expect(m.amtOwed.toNumber()).toBeGreaterThanOrEqual(0);
        }
  });
});
