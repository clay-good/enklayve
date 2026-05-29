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
