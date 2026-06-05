import { describe, it, expect } from "vitest";
import {
  compoundGrowth,
  rentVsBuy,
  collegeCostPlan,
  MAX_YEARS,
  MAX_PERIODS,
} from "../../src/engine/finance";
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
