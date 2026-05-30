import { describe, it, expect } from "vitest";
import { compoundGrowth } from "../../src/engine/finance";

/**
 * Golden cases for the deterministic time-value-of-money math (BUILD-SPEC.md
 * §3.4, §9). Exact closed-form cases plus a cross-check against the
 * independent floating-point formula to catch any drift in the decimal.js path.
 */
describe("compound growth", () => {
  it("with a zero rate is simple summation", () => {
    const r = compoundGrowth({
      principal: 1000,
      contribution: 100,
      annualRate: 0,
      years: 1,
      periodsPerYear: 12,
    });
    expect(r.periods).toBe(12);
    expect(r.totalContributed.toNumber()).toBe(2200); // 1000 + 100*12
    expect(r.futureValue.toNumber()).toBe(2200);
    expect(r.totalGrowth.toNumber()).toBe(0);
  });

  it("grows a lump sum at a known annual rate exactly", () => {
    // $1,000 at 12% compounded annually for 1 year -> $1,120 exactly.
    const r = compoundGrowth({
      principal: 1000,
      contribution: 0,
      annualRate: 0.12,
      years: 1,
      periodsPerYear: 1,
    });
    expect(r.futureValue.roundToCents().toNumber()).toBe(1120);
    expect(r.totalContributed.toNumber()).toBe(1000);
    expect(r.totalGrowth.roundToCents().toNumber()).toBe(120);
  });

  it("matches the independent annuity formula for a monthly plan", () => {
    const input = {
      principal: 10000,
      contribution: 500,
      annualRate: 0.06,
      years: 30,
      periodsPerYear: 12,
    };
    const r = compoundGrowth(input);

    // Independent float computation of FV = P(1+i)^n + C[((1+i)^n - 1)/i].
    const i = input.annualRate / input.periodsPerYear;
    const n = input.years * input.periodsPerYear;
    const factor = Math.pow(1 + i, n);
    const expected = input.principal * factor + input.contribution * ((factor - 1) / i);

    // Within a dollar across a 30-year horizon — the decimal path is exact;
    // the float reference carries the rounding error.
    expect(Math.abs(r.futureValue.toNumber() - expected)).toBeLessThan(1);
    expect(r.totalContributed.toNumber()).toBe(10000 + 500 * 360);
    expect(r.futureValue.greaterThan(r.totalContributed)).toBe(true);
  });

  it("never loses a cent: futureValue = contributed + growth", () => {
    const r = compoundGrowth({
      principal: 2500,
      contribution: 250,
      annualRate: 0.05,
      years: 10,
      periodsPerYear: 12,
    });
    expect(r.totalContributed.add(r.totalGrowth).roundToCents().toNumber()).toBe(
      r.futureValue.roundToCents().toNumber(),
    );
  });
});

import { debtPayoff } from "../../src/engine/finance";

/**
 * Golden cases for the Freedom Date payoff math (BUILD-SPEC.md §5.1, §9).
 * Deterministic month-by-month payoff; a payment that can't cover the interest
 * is surfaced as "never" rather than an infinite loop.
 */
describe("debt payoff", () => {
  it("zero rate is simple division (rounded up to whole months)", () => {
    const r = debtPayoff(6000, 0, 500);
    expect(r).not.toBeNull();
    expect(r!.months).toBe(12);
    expect(r!.totalInterest.toNumber()).toBe(0);
    expect(r!.totalPaid.roundToCents().toNumber()).toBe(6000);
  });

  it("charges interest and pays off a card in finite time", () => {
    const r = debtPayoff(6000, 22, 300);
    expect(r).not.toBeNull();
    // ~24 months, with real interest paid.
    expect(r!.months).toBeGreaterThan(20);
    expect(r!.months).toBeLessThan(30);
    expect(r!.totalInterest.toNumber()).toBeGreaterThan(0);
    // Total paid = principal + interest.
    expect(r!.totalPaid.roundToCents().toNumber()).toBe(
      r!.totalInterest.add(6000).roundToCents().toNumber(),
    );
  });

  it("returns null when the payment can't cover the monthly interest", () => {
    // $10,000 at 18% accrues $150/mo; a $150 payment never reduces the balance.
    expect(debtPayoff(10000, 18, 150)).toBeNull();
  });

  it("treats a zero balance as already free", () => {
    const r = debtPayoff(0, 22, 300);
    expect(r).not.toBeNull();
    expect(r!.months).toBe(0);
  });

  it("is deterministic", () => {
    expect(debtPayoff(6000, 22, 300)).toEqual(debtPayoff(6000, 22, 300));
  });
});

import { monthlyMortgagePayment, loanPrincipalFromPayment } from "../../src/engine/finance";

/**
 * Golden cases for the loan/mortgage math (BUILD-SPEC.md §3.3, §6.3). The
 * payment and the principal-from-payment functions are exact inverses, and a
 * zero rate degenerates to simple division/multiplication.
 */
describe("mortgage math", () => {
  it("computes the standard monthly payment", () => {
    // $300,000 at 6% for 30 years ≈ $1,798.65/mo (published amortization value).
    const m = monthlyMortgagePayment(300000, 6, 30);
    expect(m.roundToCents().toNumber()).toBeCloseTo(1798.65, 1);
  });

  it("zero rate is principal divided over the term", () => {
    expect(monthlyMortgagePayment(360000, 0, 30).roundToCents().toNumber()).toBe(1000);
    expect(loanPrincipalFromPayment(1000, 0, 30).roundToCents().toNumber()).toBe(360000);
  });

  it("principal-from-payment inverts payment", () => {
    const payment = monthlyMortgagePayment(300000, 6, 30);
    const principal = loanPrincipalFromPayment(payment.toNumber(), 6, 30);
    expect(principal.roundToCents().toNumber()).toBeCloseTo(300000, 0);
  });

  it("a bigger budget supports a bigger loan", () => {
    const small = loanPrincipalFromPayment(1500, 6.5, 30).toNumber();
    const big = loanPrincipalFromPayment(2500, 6.5, 30).toNumber();
    expect(big).toBeGreaterThan(small);
  });
});

import { annualFromHourly, hourlyFromAnnual } from "../../src/engine/finance";

/**
 * Golden cases for the hourly↔salary conversion (BUILD-SPEC.md §3.1). Regular
 * hours pay the base rate; overtime pays 1.5×. The annual→hourly path inverts
 * the no-overtime annual.
 */
describe("pay conversion", () => {
  it("annualizes a regular wage exactly", () => {
    // $28/hr × 40 hrs × 52 wks = $58,240.
    const a = annualFromHourly({
      hourlyRate: 28,
      hoursPerWeek: 40,
      overtimeHoursPerWeek: 0,
      weeksPerYear: 52,
    });
    expect(a.roundToCents().toNumber()).toBe(58240);
  });

  it("pays overtime at 1.5×", () => {
    // + $28 × 1.5 × 5 hrs × 52 wks = $10,920 → $69,160.
    const a = annualFromHourly({
      hourlyRate: 28,
      hoursPerWeek: 40,
      overtimeHoursPerWeek: 5,
      weeksPerYear: 52,
    });
    expect(a.roundToCents().toNumber()).toBe(69160);
  });

  it("inverts annual→hourly for the regular case", () => {
    expect(hourlyFromAnnual(58240, 40, 52).roundToCents().toNumber()).toBe(28);
    // No hours to divide across → zero, never a divide-by-zero.
    expect(hourlyFromAnnual(58240, 0, 52).isZero()).toBe(true);
  });
});

import { amortizationSummary } from "../../src/engine/finance";

/**
 * Golden cases for the amortization what-if (BUILD-SPEC.md §3.3). The scheduled
 * payment comes from the mortgage formula; baseline and with-extra payoffs run
 * through the same month-by-month engine, so they agree at extra = 0.
 */
describe("amortization summary", () => {
  it("zero rate: extra payment halves the term, no interest", () => {
    const r = amortizationSummary({
      principal: 360000,
      annualRatePct: 0,
      termYears: 30,
      extraMonthly: 1000,
    });
    expect(r.scheduledPayment.roundToCents().toNumber()).toBe(1000);
    expect(r.baselineMonths).toBe(360);
    expect(r.payoffMonths).toBe(180); // paying $2,000/mo on $360k
    expect(r.monthsSaved).toBe(180);
    expect(r.totalInterest.isZero()).toBe(true);
    expect(r.interestSaved.isZero()).toBe(true);
  });

  it("no extra payment saves nothing", () => {
    const r = amortizationSummary({
      principal: 300000,
      annualRatePct: 6,
      termYears: 30,
      extraMonthly: 0,
    });
    expect(r.scheduledPayment.roundToCents().toNumber()).toBeCloseTo(1798.65, 1);
    expect(r.monthsSaved).toBe(0);
    expect(r.interestSaved.isZero()).toBe(true);
    expect(r.payoffMonths).toBe(r.baselineMonths);
  });

  it("an extra payment saves interest and time", () => {
    const r = amortizationSummary({
      principal: 300000,
      annualRatePct: 6,
      termYears: 30,
      extraMonthly: 200,
    });
    expect(r.monthsSaved).toBeGreaterThan(0);
    expect(r.interestSaved.greaterThan(0)).toBe(true);
    expect(r.totalInterest.lessThan(r.baselineInterest)).toBe(true);
  });

  it("is deterministic", () => {
    const i = { principal: 250000, annualRatePct: 5.5, termYears: 30, extraMonthly: 150 };
    expect(amortizationSummary(i)).toEqual(amortizationSummary(i));
  });
});

import { refinanceBreakEven } from "../../src/engine/finance";

/**
 * Golden cases for refinance break-even (BUILD-SPEC.md §3.3). A lower rate
 * lowers the payment; the closing costs are recouped over a whole number of
 * months of that saving. A rate that isn't lower has no break-even.
 */
describe("refinance break-even", () => {
  it("recoups closing costs from the monthly saving", () => {
    const r = refinanceBreakEven({
      balance: 300000,
      currentRatePct: 7,
      currentRemainingYears: 30,
      newRatePct: 5.5,
      newTermYears: 30,
      closingCosts: 6000,
    });
    expect(r.monthlySavings.greaterThan(0)).toBe(true);
    // ~$292/mo saved → ceil(6000/292) ≈ 21 months.
    expect(r.breakEvenMonths).not.toBeNull();
    expect(r.breakEvenMonths!).toBeGreaterThan(15);
    expect(r.breakEvenMonths!).toBeLessThan(30);
    // The lower rate also means less interest over the same 30-year term.
    expect(r.newTotalInterest.lessThan(r.currentRemainingInterest)).toBe(true);
  });

  it("has no break-even when the new rate isn't lower", () => {
    const r = refinanceBreakEven({
      balance: 300000,
      currentRatePct: 5,
      currentRemainingYears: 30,
      newRatePct: 6,
      newTermYears: 30,
      closingCosts: 6000,
    });
    expect(r.monthlySavings.isNegative()).toBe(true);
    expect(r.breakEvenMonths).toBeNull();
  });

  it("breaks even immediately with no closing costs", () => {
    const r = refinanceBreakEven({
      balance: 200000,
      currentRatePct: 7,
      currentRemainingYears: 25,
      newRatePct: 5,
      newTermYears: 25,
      closingCosts: 0,
    });
    expect(r.breakEvenMonths).toBe(0);
  });

  it("is deterministic", () => {
    const i = {
      balance: 250000,
      currentRatePct: 6.5,
      currentRemainingYears: 28,
      newRatePct: 5.25,
      newTermYears: 30,
      closingCosts: 4500,
    };
    expect(refinanceBreakEven(i)).toEqual(refinanceBreakEven(i));
  });
});

import { coastFireProjection, sabbaticalPlan } from "../../src/engine/finance";

/**
 * Golden cases for the Downshift Point (coast-FIRE) projection (BUILD-SPEC.md
 * §5.1, §9). The growth factor (1+r)^years is computed by hand; the return is
 * the user's assumption, never a prediction.
 */
describe("coast-FIRE projection", () => {
  it("reports the coast number and gap when not yet reached", () => {
    // 200,000 at 5% real for 20 years → 200,000 × 1.05^20 = 530,659.54.
    // Coast number = 1,000,000 / 1.05^20 = 376,889.48; gap = 176,889.48.
    const r = coastFireProjection({
      currentBalance: 200000,
      annualRealReturnPct: 5,
      years: 20,
      targetNumber: 1000000,
    });
    expect(r.projected.roundToCents().toNumber()).toBeCloseTo(530659.54, 1);
    expect(r.coastNumber.roundToCents().toNumber()).toBeCloseTo(376889.48, 1);
    expect(r.reached).toBe(false);
    expect(r.gap.roundToCents().toNumber()).toBeCloseTo(176889.48, 1);
  });

  it("marks the Downshift Point reached once today's balance coasts to target", () => {
    // 400,000 × 1.05^20 = 1,061,319.08 ≥ 1,000,000 → reached, no gap.
    const r = coastFireProjection({
      currentBalance: 400000,
      annualRealReturnPct: 5,
      years: 20,
      targetNumber: 1000000,
    });
    expect(r.reached).toBe(true);
    expect(r.gap.isZero()).toBe(true);
  });

  it("with a zero return, the projection is just today's balance", () => {
    const r = coastFireProjection({
      currentBalance: 50000,
      annualRealReturnPct: 0,
      years: 30,
      targetNumber: 100000,
    });
    expect(r.projected.toNumber()).toBe(50000);
    expect(r.coastNumber.toNumber()).toBe(100000);
    expect(r.reached).toBe(false);
  });
});

/**
 * Golden cases for the sabbatical / big-purchase planner (BUILD-SPEC.md §5.2,
 * §9). Pure arithmetic on the user's own numbers.
 */
describe("sabbatical planner", () => {
  it("computes the cost, leftover, and runway of an affordable break", () => {
    // 6 months at 4,000/mo burn, no income → 24,000 cost; 30,000 − 24,000 = 6,000
    // left; 6,000 / 4,000 = 1.5 months of runway after.
    const r = sabbaticalPlan({
      savings: 30000,
      monthlyEssentialBurn: 4000,
      breakMonths: 6,
      monthlyIncomeDuringBreak: 0,
      oneTimeCost: 0,
    });
    expect(r.totalCost.toNumber()).toBe(24000);
    expect(r.remaining.toNumber()).toBe(6000);
    expect(r.affordable).toBe(true);
    expect(r.runwayAfterMonths).toBeCloseTo(1.5, 5);
  });

  it("credits income earned during the break", () => {
    // net draw 4,000 − 1,500 = 2,500/mo × 6 = 15,000.
    const r = sabbaticalPlan({
      savings: 30000,
      monthlyEssentialBurn: 4000,
      breakMonths: 6,
      monthlyIncomeDuringBreak: 1500,
      oneTimeCost: 0,
    });
    expect(r.netMonthlyDraw.toNumber()).toBe(2500);
    expect(r.totalCost.toNumber()).toBe(15000);
    expect(r.remaining.toNumber()).toBe(15000);
  });

  it("flags a shortfall calmly (remaining goes negative, not affordable)", () => {
    const r = sabbaticalPlan({
      savings: 10000,
      monthlyEssentialBurn: 4000,
      breakMonths: 6,
      monthlyIncomeDuringBreak: 0,
      oneTimeCost: 0,
    });
    expect(r.affordable).toBe(false);
    expect(r.remaining.toNumber()).toBe(-14000);
    expect(r.runwayAfterMonths).toBe(0);
  });

  it("handles a pure big purchase (no break months)", () => {
    const r = sabbaticalPlan({
      savings: 30000,
      monthlyEssentialBurn: 4000,
      breakMonths: 0,
      monthlyIncomeDuringBreak: 0,
      oneTimeCost: 20000,
    });
    expect(r.totalCost.toNumber()).toBe(20000);
    expect(r.remaining.toNumber()).toBe(10000);
    expect(r.affordable).toBe(true);
  });
});

import {
  requiredMonthlyContribution,
  healthPlanAnnualCost,
  rentVsBuy,
} from "../../src/engine/finance";

/**
 * Golden cases for the sinking-fund planner (BUILD-SPEC-2 §6.3, §9). Solves the
 * future-value-of-an-annuity equation; the return is the user's assumption.
 */
describe("sinking fund planner", () => {
  it("with a zero return is simple division of the remaining amount", () => {
    const r = requiredMonthlyContribution({
      currentSaved: 0,
      target: 12000,
      months: 12,
      annualReturnPct: 0,
    });
    expect(r.monthlyContribution.roundToCents().toNumber()).toBe(1000);
    expect(r.alreadyOnTrack).toBe(false);
  });

  it("credits an assumed return so a smaller contribution suffices", () => {
    // FV 10,000 in 24 months at 6% → 10,000 × 0.005 / (1.005^24 − 1) = 393.21.
    const r = requiredMonthlyContribution({
      currentSaved: 0,
      target: 10000,
      months: 24,
      annualReturnPct: 6,
    });
    expect(r.monthlyContribution.roundToCents().toNumber()).toBeCloseTo(393.21, 1);
  });

  it("counts what's already saved, growing it before solving", () => {
    // 5,000 grows to 5,635.80 at 6% over 24mo; remaining 4,364.20 → 171.60/mo.
    const r = requiredMonthlyContribution({
      currentSaved: 5000,
      target: 10000,
      months: 24,
      annualReturnPct: 6,
    });
    expect(r.projectedFromCurrent.roundToCents().toNumber()).toBeCloseTo(5635.8, 1);
    expect(r.monthlyContribution.roundToCents().toNumber()).toBeCloseTo(171.6, 1);
  });

  it("needs nothing more when today's balance already reaches the target", () => {
    const r = requiredMonthlyContribution({
      currentSaved: 10000,
      target: 8000,
      months: 12,
      annualReturnPct: 5,
    });
    expect(r.alreadyOnTrack).toBe(true);
    expect(r.monthlyContribution.isZero()).toBe(true);
  });
});

/**
 * Golden cases for the health-plan annual cost (BUILD-SPEC-2 §6.4, §9).
 */
describe("health plan annual cost", () => {
  const plan = {
    monthlyPremium: 300,
    deductible: 2000,
    coinsuranceRate: 0.2,
    outOfPocketMax: 6000,
  };

  it("charges full cost up to the deductible", () => {
    const r = healthPlanAnnualCost({ ...plan, expectedAnnualSpend: 1000 });
    expect(r.memberCost.toNumber()).toBe(1000);
    expect(r.totalAnnualCost.toNumber()).toBe(4600); // 3,600 premiums + 1,000
  });

  it("applies coinsurance above the deductible", () => {
    // 2,000 + (10,000 − 2,000) × 20% = 3,600 member; + 3,600 premiums = 7,200.
    const r = healthPlanAnnualCost({ ...plan, expectedAnnualSpend: 10000 });
    expect(r.memberCost.toNumber()).toBe(3600);
    expect(r.totalAnnualCost.toNumber()).toBe(7200);
  });

  it("caps member cost at the out-of-pocket maximum", () => {
    const r = healthPlanAnnualCost({ ...plan, expectedAnnualSpend: 50000 });
    expect(r.memberCost.toNumber()).toBe(6000);
    expect(r.totalAnnualCost.toNumber()).toBe(9600); // 3,600 + 6,000
  });
});

/**
 * Golden cases for rent vs buy (BUILD-SPEC-2 §6.3, §9). With every growth rate
 * at zero the model reduces to clean arithmetic that's checkable by hand.
 */
describe("rent vs buy", () => {
  it("compares net cost over the horizon (all rates zero → exact)", () => {
    // Buy: upfront 60,000 + P&I 40,000 (240,000/360 × 60) + ownership 30,000
    //      − sale proceeds 100,000 (300,000 − 200,000 balance) = 30,000.
    // Rent: 2,000 × 12 × 5 = 120,000, no investment gain. Buy wins by 90,000.
    const r = rentVsBuy({
      homePrice: 300000,
      downPayment: 60000,
      mortgageRatePct: 0,
      termYears: 30,
      monthlyOwnershipCosts: 500,
      closingCostBuy: 0,
      sellingCostPct: 0,
      homeAppreciationPct: 0,
      monthlyRent: 2000,
      rentGrowthPct: 0,
      investmentReturnPct: 0,
      years: 5,
    });
    expect(r.netCostBuy.roundToCents().toNumber()).toBe(30000);
    expect(r.netCostRent.roundToCents().toNumber()).toBe(120000);
    expect(r.cheaper).toBe("buy");
    expect(r.difference.roundToCents().toNumber()).toBe(90000);
  });

  it("is deterministic with realistic assumptions", () => {
    const input = {
      homePrice: 400000,
      downPayment: 80000,
      mortgageRatePct: 6.5,
      termYears: 30,
      monthlyOwnershipCosts: 700,
      closingCostBuy: 8000,
      sellingCostPct: 6,
      homeAppreciationPct: 3,
      monthlyRent: 2200,
      rentGrowthPct: 3,
      investmentReturnPct: 6,
      years: 7,
    };
    expect(rentVsBuy(input)).toEqual(rentVsBuy(input));
  });
});

import { cashFlowTimeline, lifeInsuranceNeed } from "../../src/engine/finance";

/**
 * Golden cases for the cash-flow timeline (BUILD-SPEC-2 §6.1, §9). A running
 * daily balance over dated income and bills; flags the tightest day.
 */
describe("cash-flow timeline", () => {
  it("runs a balance through the month and finds the tightest day", () => {
    const r = cashFlowTimeline(500, [
      { day: 1, amount: 3000 },
      { day: 2, amount: -2000 },
      { day: 10, amount: -1200 },
      { day: 15, amount: 3000 },
      { day: 28, amount: -2500 },
    ]);
    // 500 → 3,500 → 1,500 → 300 (low, day 10) → 3,300 → 800 (end).
    expect(r.days.map((d) => d.balance)).toEqual([3500, 1500, 300, 3300, 800]);
    expect(r.endingBalance.toNumber()).toBe(800);
    expect(r.minBalance.toNumber()).toBe(300);
    expect(r.minDay).toBe(10);
    expect(r.goesNegative).toBe(false);
  });

  it("flags a day the balance goes negative", () => {
    const r = cashFlowTimeline(200, [{ day: 5, amount: -500 }]);
    expect(r.minBalance.toNumber()).toBe(-300);
    expect(r.minDay).toBe(5);
    expect(r.goesNegative).toBe(true);
  });

  it("sums multiple events landing on the same day", () => {
    const r = cashFlowTimeline(0, [
      { day: 1, amount: 1000 },
      { day: 1, amount: -250 },
    ]);
    expect(r.days).toHaveLength(1);
    expect(r.days[0]!.net).toBe(750);
    expect(r.endingBalance.toNumber()).toBe(750);
  });
});

/**
 * Golden cases for the life-insurance needs method (BUILD-SPEC-2 §6.6, §9).
 */
describe("life insurance need", () => {
  it("sums income replacement, debts, mortgage, and obligations, less offsets", () => {
    const r = lifeInsuranceNeed({
      annualIncome: 80000,
      yearsToReplace: 10,
      debts: 20000,
      mortgageBalance: 250000,
      finalExpenses: 15000,
      futureObligations: 100000,
      existingCoverage: 100000,
      liquidAssets: 50000,
    });
    expect(r.incomeReplacement.toNumber()).toBe(800000);
    expect(r.totalNeed.toNumber()).toBe(1185000); // 800k + 20k + 250k + 15k + 100k
    expect(r.recommendedCoverage.toNumber()).toBe(1035000); // less 150k offsets
  });

  it("never recommends negative coverage when assets already exceed the need", () => {
    const r = lifeInsuranceNeed({
      annualIncome: 50000,
      yearsToReplace: 5,
      debts: 0,
      mortgageBalance: 0,
      finalExpenses: 10000,
      futureObligations: 0,
      existingCoverage: 500000,
      liquidAssets: 0,
    });
    expect(r.recommendedCoverage.isZero()).toBe(true);
  });
});

import { disabilityCoverageNeed, umbrellaCoverageNeed } from "../../src/engine/finance";

describe("disability coverage need", () => {
  it("targets a share of income and subtracts existing coverage and other income", () => {
    const r = disabilityCoverageNeed({
      annualIncome: 90000,
      replacementRatePct: 60,
      existingMonthlyBenefit: 2000,
      otherMonthlyIncome: 500,
    });
    // 90,000 × 60% ÷ 12 = $4,500 target; covered 2,500; gap $2,000/mo, $24,000/yr.
    expect(r.targetMonthly.toNumber()).toBe(4500);
    expect(r.coveredMonthly.toNumber()).toBe(2500);
    expect(r.monthlyGap.toNumber()).toBe(2000);
    expect(r.annualGap.toNumber()).toBe(24000);
  });

  it("never reports a negative gap when coverage already exceeds the target", () => {
    const r = disabilityCoverageNeed({
      annualIncome: 60000,
      replacementRatePct: 60,
      existingMonthlyBenefit: 5000,
      otherMonthlyIncome: 0,
    });
    expect(r.monthlyGap.isZero()).toBe(true);
  });
});

describe("umbrella coverage need", () => {
  it("covers uncovered net worth, rounded up to the next $1M layer", () => {
    const r = umbrellaCoverageNeed({
      netWorth: 1300000,
      futureIncomeExposure: 0,
      existingLiabilityCoverage: 500000,
      policyIncrement: 1000000,
    });
    // Exposure 1.3M, uncovered 800k → rounds up to a $1M umbrella.
    expect(r.exposure.toNumber()).toBe(1300000);
    expect(r.uncoveredExposure.toNumber()).toBe(800000);
    expect(r.recommendedUmbrella.toNumber()).toBe(1000000);
  });

  it("adds future-income exposure and needs two layers when uncovered exposure exceeds one", () => {
    const r = umbrellaCoverageNeed({
      netWorth: 1500000,
      futureIncomeExposure: 600000,
      existingLiabilityCoverage: 0,
      policyIncrement: 1000000,
    });
    // Exposure 2.1M, none covered → rounds up to a $3M umbrella.
    expect(r.uncoveredExposure.toNumber()).toBe(2100000);
    expect(r.recommendedUmbrella.toNumber()).toBe(3000000);
  });

  it("recommends nothing when existing coverage already exceeds exposure", () => {
    const r = umbrellaCoverageNeed({
      netWorth: 300000,
      futureIncomeExposure: 0,
      existingLiabilityCoverage: 500000,
      policyIncrement: 1000000,
    });
    expect(r.uncoveredExposure.isZero()).toBe(true);
    expect(r.recommendedUmbrella.isZero()).toBe(true);
  });
});

import { retirementDrawdown, collegeCostPlan } from "../../src/engine/finance";
import { loadDatasets, type Datasets } from "../helpers/datasets";

describe("retirement drawdown", () => {
  it("exhausts a flat-return balance in exactly balance ÷ withdrawal years", () => {
    const r = retirementDrawdown({
      currentBalance: 100000,
      currentAge: 60,
      annualWithdrawal: 10000,
      realReturnPct: 0,
    });
    // $100k ÷ $10k = 10 years; depleted after the age-69 withdrawal.
    expect(r.depletedAtAge).toBe(69);
    expect(r.yearsLasting).toBe(10);
    expect(r.totalWithdrawn.toNumber()).toBe(100000);
    expect(r.lastsToMaxAge).toBe(false);
  });

  it("never depletes when the real return covers the withdrawals", () => {
    const r = retirementDrawdown({
      currentBalance: 100000,
      currentAge: 60,
      annualWithdrawal: 0,
      realReturnPct: 5,
      maxAge: 100,
    });
    expect(r.depletedAtAge).toBeNull();
    expect(r.lastsToMaxAge).toBe(true);
    expect(r.yearsLasting).toBe(40);
    expect(r.totalWithdrawn.isZero()).toBe(true);
  });

  it("forces the required minimum distribution once the begin age arrives", async () => {
    const ds: Datasets = await loadDatasets();
    const r = retirementDrawdown(
      { currentBalance: 500000, currentAge: 73, annualWithdrawal: 0, realReturnPct: 0 },
      ds.rmd,
    );
    expect(r.firstRmdAge).toBe(73);
    // 500,000 ÷ 26.5 (age-73 factor) = $18,867.92, withdrawn even though the chosen draw is 0.
    expect(r.timeline[0]!.rmd.roundToCents().toNumber()).toBe(18867.92);
    expect(r.timeline[0]!.withdrawal.roundToCents().toNumber()).toBe(18867.92);
  });
});

describe("college cost plan", () => {
  it("sums the enrollment years and solves the monthly contribution (no inflation)", () => {
    const r = collegeCostPlan({
      annualCostToday: 25000,
      yearsUntilStart: 10,
      yearsOfCollege: 4,
      costInflationPct: 0,
      currentSavings: 0,
      expectedReturnPct: 0,
    });
    expect(r.projectedTotalCost.toNumber()).toBe(100000); // 25k × 4
    expect(r.monthlyContribution.roundToCents().toNumber()).toBe(833.33); // 100k / 120 months
  });

  it("inflates each year's cost forward at the assumed rate", () => {
    const r = collegeCostPlan({
      annualCostToday: 25000,
      yearsUntilStart: 10,
      yearsOfCollege: 1,
      costInflationPct: 5,
      currentSavings: 0,
      expectedReturnPct: 0,
    });
    // 25,000 × 1.05^10 = $40,722.37
    expect(r.projectedTotalCost.roundToCents().toNumber()).toBe(40722.37);
  });

  it("recognizes when current savings already cover the projected cost", () => {
    const r = collegeCostPlan({
      annualCostToday: 25000,
      yearsUntilStart: 10,
      yearsOfCollege: 4,
      costInflationPct: 0,
      currentSavings: 200000,
      expectedReturnPct: 0,
    });
    expect(r.alreadyOnTrack).toBe(true);
    expect(r.monthlyContribution.isZero()).toBe(true);
  });
});

import { balanceTransferBreakEven } from "../../src/engine/finance";

describe("balance transfer break-even", () => {
  it("compares an interest-bearing card against a 0% transfer with a fee", () => {
    const r = balanceTransferBreakEven({
      balance: 6000,
      currentAprPct: 24,
      monthlyPayment: 1000,
      transferFeePct: 3,
      introAprPct: 0,
      introMonths: 12,
      postIntroAprPct: 18,
    });
    // Current card: paid off in 7 months with $457.83 of interest.
    expect(r.currentMonths).toBe(7);
    expect(r.currentInterest!.roundToCents().toNumber()).toBe(457.83);
    // Transfer: $180 fee, then $6,180 at 0% clears in 7 months with no interest.
    expect(r.transferFee.toNumber()).toBe(180);
    expect(r.transferMonths).toBe(7);
    expect(r.transferInterest!.isZero()).toBe(true);
    expect(r.transferTotalCost!.toNumber()).toBe(180);
    expect(r.paysOffWithinIntro).toBe(true);
    // Saving = $457.83 interest avoided − $180 fee = $277.83.
    expect(r.interestSaved!.roundToCents().toNumber()).toBe(277.83);
  });

  it("flags a payment that can't cover the current card's interest", () => {
    const r = balanceTransferBreakEven({
      balance: 10000,
      currentAprPct: 25,
      monthlyPayment: 200, // less than the $208/mo interest at 25%
      transferFeePct: 3,
      introAprPct: 0,
      introMonths: 12,
      postIntroAprPct: 18,
    });
    expect(r.currentMonths).toBeNull();
    expect(r.currentInterest).toBeNull();
    // The 0% intro path knocks the balance down enough that the post-intro
    // payment (vs ~18%) covers the interest, so the transfer still pays off.
    expect(r.transferMonths).not.toBeNull();
    expect(r.interestSaved).toBeNull(); // can't compare savings when one path never ends
  });
});

import { debtFreedomPlan } from "../../src/engine/finance";

/**
 * Golden cases for the debt-freedom planner (BUILD-SPEC-2 §6.2): the snowball
 * (smallest balance first) vs the avalanche (highest rate first), both run on a
 * fixed monthly budget of the minimums plus an extra, rolling freed-up payments
 * forward. Deterministic; pure arithmetic on the user's own balances.
 */
describe("debt freedom planner", () => {
  it("retires both methods in the same time and order at 0% interest", () => {
    // No interest → the order can't change the months, only which clears first.
    const r = debtFreedomPlan(
      [
        { name: "A", balance: 1000, ratePct: 0, minPayment: 50 },
        { name: "B", balance: 500, ratePct: 0, minPayment: 50 },
      ],
      100,
    );
    expect(r.monthlyTotal).toBe(200); // 50 + 50 + 100 extra
    expect(r.totalMinimum).toBe(100);
    expect(r.snowball.months).toBe(8);
    expect(r.avalanche.months).toBe(8);
    expect(r.snowball.totalInterest.toNumber()).toBe(0);
    expect(r.avalanche.totalInterest.toNumber()).toBe(0);
    // Snowball clears the smaller balance (B) first; the rate tie keeps the
    // avalanche in entry order, so it attacks A first.
    expect(r.snowball.payoffOrder.map((p) => p.name)).toEqual(["B", "A"]);
    expect(r.avalanche.payoffOrder.map((p) => p.name)).toEqual(["A", "B"]);
    expect(r.interestSaved!.toNumber()).toBe(0);
    expect(r.monthsSaved).toBe(0);
  });

  it("avalanche never costs more interest, and targets the highest rate first", () => {
    const r = debtFreedomPlan(
      [
        { name: "Cheap", balance: 1000, ratePct: 5, minPayment: 50 },
        { name: "Pricey", balance: 1000, ratePct: 25, minPayment: 50 },
      ],
      200,
    );
    expect(r.snowball.months).not.toBeNull();
    expect(r.avalanche.months).not.toBeNull();
    // Equal balances → snowball ties to entry order (Cheap first); avalanche
    // always hits the 25% card first.
    expect(r.snowball.payoffOrder[0]!.name).toBe("Cheap");
    expect(r.avalanche.payoffOrder[0]!.name).toBe("Pricey");
    // The avalanche minimizes interest, so it never pays more and here pays less.
    expect(r.avalanche.totalInterest.toNumber()).toBeLessThan(r.snowball.totalInterest.toNumber());
    expect(r.interestSaved!.toNumber()).toBeGreaterThan(0);
    expect(r.monthsSaved!).toBeGreaterThanOrEqual(0);
  });

  it("matches single-debt debtPayoff when there is one debt", () => {
    const plan = debtFreedomPlan(
      [{ name: "Card", balance: 1000, ratePct: 12, minPayment: 0 }],
      100,
    );
    const single = debtPayoff(1000, 12, 100);
    expect(plan.snowball.months).toBe(single!.months);
    expect(plan.snowball.totalInterest.toNumber()).toBeCloseTo(single!.totalInterest.toNumber(), 6);
  });

  it("reports 'never' when the budget can't cover the interest", () => {
    const r = debtFreedomPlan([{ name: "Trap", balance: 10000, ratePct: 30, minPayment: 10 }], 0);
    expect(r.snowball.months).toBeNull();
    expect(r.avalanche.months).toBeNull();
    expect(r.interestSaved).toBeNull();
    expect(r.monthsSaved).toBeNull();
  });

  it("ignores zero-balance debts and is deterministic", () => {
    const debts = [
      { name: "Paid", balance: 0, ratePct: 20, minPayment: 0 },
      { name: "Visa", balance: 2000, ratePct: 19, minPayment: 60 },
      { name: "Car", balance: 8000, ratePct: 6, minPayment: 200 },
    ];
    const a = debtFreedomPlan(debts, 300);
    const b = debtFreedomPlan(debts, 300);
    expect(a.snowball.months).toBe(b.snowball.months);
    expect(a.avalanche.totalInterest.toNumber()).toBe(b.avalanche.totalInterest.toNumber());
    // The already-paid debt isn't counted into the minimums.
    expect(a.totalMinimum).toBe(260);
    // Snowball attacks the smaller live balance (Visa) first.
    expect(a.snowball.payoffOrder[0]!.name).toBe("Visa");
  });
});
