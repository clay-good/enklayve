import { describe, it, expect } from "vitest";
import { interestPaidOverMonths, amortizationSummary } from "../../src/engine/finance";

/**
 * Interest paid over the first N months of a loan.
 *
 * The total cost of credit is the figure that makes a borrower think twice.
 * This is the other one: IRC §163(h)(4) deducts car loan interest **paid during
 * the taxable year**, so what goes on a return is a year of a loan, not the life
 * of one — and the first year is the largest, which makes it the year that says
 * whether the $10,000 ceiling is anywhere near.
 */
describe("interest over a window of a loan", () => {
  const LOAN = 33_500;
  const APR = 7.5;
  const YEARS = 6;

  it("agrees with the full amortization at the end of the term", () => {
    // The same schedule read two ways: every payment is principal or interest,
    // so the window that covers the whole term is the total cost of credit.
    const full = amortizationSummary({
      principal: LOAN,
      annualRatePct: APR,
      termYears: YEARS,
      extraMonthly: 0,
    });
    expect(interestPaidOverMonths(LOAN, APR, YEARS, YEARS * 12).toNumber()).toBeCloseTo(
      full.totalInterest.toNumber(),
      0,
    );
  });

  it("front-loads, which is why the first year is the deductible year that matters", () => {
    const year1 = interestPaidOverMonths(LOAN, APR, YEARS, 12).toNumber();
    const year2 = interestPaidOverMonths(LOAN, APR, YEARS, 24).toNumber() - year1;
    expect(year1).toBeGreaterThan(year2);
    // A $33,500 loan at 7.5% pays about $2,300 in its first year — well under
    // §163(h)(4)'s $10,000 ceiling, which is the point of showing the figure.
    expect(year1).toBeGreaterThan(2200);
    expect(year1).toBeLessThan(2400);
  });

  it("clamps the window to the term instead of inventing a year", () => {
    const whole = interestPaidOverMonths(LOAN, APR, YEARS, YEARS * 12).toNumber();
    expect(interestPaidOverMonths(LOAN, APR, YEARS, YEARS * 12 + 24).toNumber()).toBe(whole);
  });

  it("is zero for a zero-rate loan, a zero balance, and a zero window", () => {
    expect(interestPaidOverMonths(12_000, 0, 1, 12).toNumber()).toBe(0);
    expect(interestPaidOverMonths(0, APR, YEARS, 12).toNumber()).toBe(0);
    expect(interestPaidOverMonths(LOAN, APR, YEARS, 0).toNumber()).toBe(0);
  });

  it("never returns a negative, whatever it is handed", () => {
    expect(interestPaidOverMonths(-5000, APR, YEARS, 12).toNumber()).toBe(0);
    expect(interestPaidOverMonths(LOAN, APR, YEARS, -12).toNumber()).toBe(0);
  });
});
