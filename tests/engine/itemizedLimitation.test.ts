import { describe, it, expect, beforeAll } from "vitest";
import { evaluateTaxes } from "../../src/engine/tax";
import { loadDatasets } from "../helpers/datasets";

/**
 * IRC §68, the overall limitation on itemized deductions.
 *
 * Switched off for every year from 2018 through 2025 and rewritten by the One
 * Big Beautiful Bill Act, so 2026 is the first year in eight that it does
 * anything — and it does something different from what it used to. The old §68
 * phased the deductions out. The new one caps their VALUE: reduce them by "2/37
 * of the lesser of (1) such amount of itemized deductions, or (2) so much of
 * the taxable income ... as exceeds the dollar amount at which the 37 percent
 * rate bracket ... begins".
 *
 * Two thirty-sevenths of thirty-seven percent is two percent, and that identity
 * is the whole point of the section, so it is the first case below: for a filer
 * in the top bracket, another dollar of itemized deduction saves exactly 35
 * cents. If that ever reads 37, the section has stopped working.
 */
describe("the 35% cap on what an itemized deduction is worth", () => {
  let ds: Awaited<ReturnType<typeof loadDatasets>>;
  const ctx = () => ({ federal: ds.federal, fica: ds.fica });
  beforeAll(async () => {
    ds = await loadDatasets();
  });

  /** Mortgage interest only: the SALT cap has its own phase-down up here. */
  const filer = (wages: number, mortgageInterest: number) => ({
    filingStatus: "single" as const,
    wages,
    deductionMode: "itemized" as const,
    itemized: { mortgageInterest },
  });

  it("makes the next dollar of deduction worth 35 cents, not 37", () => {
    // $900,000 of wages is well inside the 37% bracket, which starts at
    // $640,600 for a single filer in 2026. A $1,000 larger mortgage-interest
    // deduction should save $350.00 and not $370.00.
    const at = (mortgage: number): number =>
      evaluateTaxes(filer(900_000, mortgage), ctx()).federal.incomeTax.toNumber();
    expect(at(60_000) - at(61_000)).toBeCloseTo(350, 2);
  });

  it("reduces by 2/37 of the deductions when income above the threshold is larger", () => {
    // Clause (1) is the lesser: $60,000 of deductions against $259,400 of income
    // over the threshold. 60,000 × 2/37 = 3,243.24, so 56,756.76 comes off.
    const r = evaluateTaxes(filer(900_000, 60_000), ctx());
    expect(r.federal.deduction.amount.toNumber()).toBeCloseTo(60_000 - (60_000 * 2) / 37, 2);
    expect(r.federal.taxableIncome.toNumber()).toBeCloseTo(900_000 - 56_756.76, 1);
  });

  it("reduces by 2/37 of the income above the threshold when THAT is smaller", () => {
    // Clause (2) is the lesser: $660,000 of wages is only $19,400 into the 37%
    // bracket, so only that much of the deduction was ever worth 37 cents.
    // 19,400 × 2/37 = 1,048.65.
    const r = evaluateTaxes(filer(660_000, 60_000), ctx());
    const over = 660_000 - 640_600;
    expect(r.federal.deduction.amount.toNumber()).toBeCloseTo(60_000 - (over * 2) / 37, 2);
  });

  it("does nothing at or below the threshold", () => {
    // A filer whose income stops exactly where the 37% bracket starts has no
    // income up there for a deduction to be over-valued against.
    const r = evaluateTaxes(filer(640_600, 60_000), ctx());
    expect(r.federal.deduction.amount.toNumber()).toBe(60_000);
    const below = evaluateTaxes(filer(300_000, 60_000), ctx());
    expect(below.federal.deduction.amount.toNumber()).toBe(60_000);
  });

  it("leaves the standard deduction alone, however high the income", () => {
    // §68 limits ITEMIZED deductions. A millionaire taking the standard
    // deduction takes all of it.
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 2_000_000, deductionMode: "standard" },
      ctx(),
    );
    expect(r.federal.deduction.amount.toNumber()).toBe(
      ds.federal.standardDeductionByFilingStatus.single,
    );
  });

  it("uses the joint schedule's own threshold for a joint return", () => {
    // $768,700 for 2026, not the single figure. A couple at $700,000 is below
    // their threshold while a single filer at the same income is above theirs.
    const joint = evaluateTaxes(
      {
        filingStatus: "married_jointly",
        wages: 700_000,
        deductionMode: "itemized",
        itemized: { mortgageInterest: 60_000 },
      },
      ctx(),
    );
    expect(joint.federal.deduction.amount.toNumber()).toBe(60_000);
    expect(
      evaluateTaxes(filer(700_000, 60_000), ctx()).federal.deduction.amount.toNumber(),
    ).toBeLessThan(60_000);
  });

  it("carries the fraction as the statute writes it, not as a decimal", () => {
    // 2/37 does not terminate. A rounded copy would be a figure nobody could
    // reproduce from the Code, so the shard holds the two integers.
    expect(ds.federal.itemizedLimitation).toEqual({
      reductionNumerator: 2,
      reductionDenominator: 37,
      thresholdRate: 0.37,
    });
  });
});
