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
