import { describe, it, expect } from "vitest";
import {
  compoundGrowth,
  rentVsBuy,
  collegeCostPlan,
  MAX_YEARS,
  MAX_PERIODS,
  MAX_HORIZON_MONTHS,
  capMonths,
  clampMonths,
} from "../../src/engine/finance";
import { lifeInsuranceNeed } from "../../src/engine/finance";
import { requiredMinimumDistribution } from "../../src/engine/rmd";
import { rothConversionLadder } from "../../src/engine/taxMoves";

/**
 * Horizon caps (robustness). A user — or a crafted deep link — can put an absurd
 * year/month/period count into a projection. Without an upper bound those drive
 * billion-iteration loops or astronomically large `Decimal.pow` exponents and
 * freeze the tab. The engine clamps every horizon input, so these calls must
 * return promptly with finite results. The 1s budget is the real assertion:
 * uncapped, each of these would take effectively forever.
 */
const ABSURD = 1_000_000_000;
const finite = (n: number): boolean => Number.isFinite(n);

describe("horizon caps keep projections bounded", () => {
  it("compoundGrowth clamps periods and returns a finite value", () => {
    const r = compoundGrowth({
      principal: 1000,
      contribution: 100,
      annualRate: 0.06,
      years: ABSURD,
      periodsPerYear: 12,
    });
    expect(r.periods).toBeLessThanOrEqual(MAX_PERIODS);
    expect(finite(r.futureValue.toNumber())).toBe(true);
  });

  it("rentVsBuy returns a finite comparison for an absurd horizon", () => {
    const r = rentVsBuy({
      homePrice: 400000,
      downPayment: 80000,
      mortgageRatePct: 6,
      termYears: ABSURD,
      monthlyOwnershipCosts: 600,
      closingCostBuy: 8000,
      sellingCostPct: 6,
      homeAppreciationPct: 3,
      monthlyRent: 2200,
      rentGrowthPct: 3,
      investmentReturnPct: 5,
      years: ABSURD,
    });
    expect(finite(r.netCostBuy.toNumber())).toBe(true);
    expect(finite(r.netCostRent.toNumber())).toBe(true);
  });

  it("rothConversionLadder caps the number of rungs", () => {
    const r = rothConversionLadder({
      startYear: 2026,
      annualConversion: 50000,
      ladderYears: ABSURD,
      ordinaryRatePct: 22,
      seasoningYears: 5,
    });
    expect(r.rungs.length).toBeLessThanOrEqual(MAX_YEARS);
  });

  it("collegeCostPlan stays finite for an absurd horizon", () => {
    const r = collegeCostPlan({
      annualCostToday: 30000,
      yearsUntilStart: ABSURD,
      yearsOfCollege: ABSURD,
      costInflationPct: 5,
      currentSavings: 10000,
      expectedReturnPct: 5,
    });
    expect(finite(r.projectedTotalCost.toNumber())).toBe(true);
    expect(finite(r.monthlyContribution.toNumber())).toBe(true);
  });
}, 1000);

describe("a computed horizon is capped without being rounded", () => {
  /**
   * `clampMonths` rounds, because what it clamps is about to become a loop
   * bound or an exponent and a fractional period is meaningless there. A
   * *reading* is different: "your savings cover 3.5 months of essentials" is
   * the answer, and rounding it to 4 moves a number the reader is looking at.
   *
   * `capMonths` exists because the Peace of Mind dashboard divides savings by
   * monthly spending itself and skipped the ceiling entirely — a deep link with
   * a cent of monthly spending printed "would stretch it to
   * 100000000000000000.0 months". Finite, so the no-NaN sweep passed it.
   */
  it("keeps the fraction a reading depends on, where clampMonths would not", () => {
    expect(capMonths(3.5)).toBe(3.5);
    expect(clampMonths(3.5)).toBe(4);
  });

  it("stops at the same ceiling every other horizon stops at", () => {
    expect(capMonths(1e17)).toBe(MAX_HORIZON_MONTHS);
    expect(capMonths(MAX_HORIZON_MONTHS)).toBe(MAX_HORIZON_MONTHS);
    // Exactly under the line is still an answer, and still exact.
    expect(capMonths(MAX_HORIZON_MONTHS - 0.5)).toBe(MAX_HORIZON_MONTHS - 0.5);
  });

  it("reads an overflowed horizon as past the ceiling, not as none at all", () => {
    // A runway can overflow to +Infinity — a large balance against a spending
    // figure small enough to underflow the division — and that household's
    // savings effectively never run out. Answering 0 would print "no runway" to
    // exactly the person who has the most, which is wrong in the alarming
    // direction. NaN says nothing, so it gets nothing, and a negative horizon
    // is not a horizon.
    expect(capMonths(Number.POSITIVE_INFINITY)).toBe(MAX_HORIZON_MONTHS);
    expect(capMonths(Number.NaN)).toBe(0);
    expect(capMonths(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(capMonths(-1)).toBe(0);
    expect(capMonths(0)).toBe(0);
  });
});

describe("a clamped horizon is reported, not just applied", () => {
  /**
   * Every cap above is correct and none of them was visible. A tile reads its
   * own field back into the label above the answer, so `?yrs=500` on the
   * life-insurance tile multiplied an income by **100** years and headed the
   * product "Income replacement (500 yr)" — the clamp was right, the sentence
   * beside it was not. The tiles clamp at the read now; these hold the two
   * engine-side halves that a tile cannot see for itself.
   */
  it("replaces at most MAX_YEARS of income, whatever the caller asks for", () => {
    const r = lifeInsuranceNeed({
      annualIncome: 100_000,
      yearsToReplace: 500,
      debts: 0,
      mortgageBalance: 0,
      finalExpenses: 0,
      futureObligations: 0,
      existingCoverage: 0,
      liquidAssets: 0,
    });
    expect(r.incomeReplacement.toNumber()).toBe(100_000 * MAX_YEARS);
  });

  it("says which age the RMD table was actually read at", () => {
    // The Uniform Lifetime Table stops at a top row and ages beyond it reuse
    // the terminal factor. The tile printed the age it was *given* beside that
    // factor, which for a crafted link read "Distribution period at age
    // 10000000000000002".
    const table = {
      beginAge: 73,
      distributionPeriodByAge: { "73": 26.5, "74": 25.5, "120": 2.0 },
      citation: { label: "IRS Pub 590-B", url: "https://www.irs.gov/publications/p590b" },
    };
    const past = requiredMinimumDistribution(1e16, 100_000, table as never);
    expect(past.lookupAge).toBe(120);
    expect(past.distributionPeriod).toBe(2.0);
    // An age inside the table is reported as itself, so the label is unchanged
    // for every reader who is not on a crafted link.
    expect(requiredMinimumDistribution(74, 100_000, table as never).lookupAge).toBe(74);
  });
});
