import { describe, it, expect } from "vitest";
import {
  taxLossHarvest,
  rothConversionLadder,
  backdoorRoth,
  megaBackdoorRoth,
} from "../../src/engine/taxMoves";

/**
 * Tax moves (BUILD-SPEC-2 §6.5, §9). Tax-loss harvesting nets gains and losses
 * per the Schedule D rules and applies the $3,000 ordinary-offset limit; the
 * Roth conversion ladder lays out the 5-year seasoning schedule. Each case works
 * the arithmetic by hand.
 */
describe("tax-loss harvesting", () => {
  it("harvests a long-term loss against a long-term gain (saves rate × loss)", () => {
    const r = taxLossHarvest({
      shortTermGain: 0,
      shortTermLoss: 0,
      longTermGain: 20000,
      longTermLoss: 15000,
      ordinaryRatePct: 24,
      longTermRatePct: 15,
      ordinaryOffsetLimit: 3000,
    });
    expect(r.netLongTerm.toNumber()).toBe(5000);
    expect(r.taxableLongTermGain.toNumber()).toBe(5000);
    expect(r.netCapitalLoss.isZero()).toBe(true);
    // 15,000 of LT loss removed at the 15% LT rate → $2,250 saved.
    expect(r.taxSaved.roundToCents().toNumber()).toBe(2250);
  });

  it("offsets ordinary income up to the limit and carries the rest forward", () => {
    const r = taxLossHarvest({
      shortTermGain: 0,
      shortTermLoss: 0,
      longTermGain: 0,
      longTermLoss: 10000,
      ordinaryRatePct: 24,
      longTermRatePct: 15,
      ordinaryOffsetLimit: 3000,
    });
    expect(r.netCapitalLoss.toNumber()).toBe(10000);
    expect(r.deductibleAgainstOrdinary.toNumber()).toBe(3000);
    expect(r.lossCarryforward.toNumber()).toBe(7000);
    // $3,000 against ordinary income at 24% → $720 saved.
    expect(r.taxSaved.roundToCents().toNumber()).toBe(720);
  });

  it("cross-nets a short-term loss against a long-term gain, surviving gain stays long-term", () => {
    const r = taxLossHarvest({
      shortTermGain: 0,
      shortTermLoss: 4000,
      longTermGain: 10000,
      longTermLoss: 0,
      ordinaryRatePct: 32,
      longTermRatePct: 15,
      ordinaryOffsetLimit: 3000,
    });
    expect(r.netShortTerm.toNumber()).toBe(-4000);
    expect(r.netLongTerm.toNumber()).toBe(10000);
    // 6,000 net long-term gain survives. Without harvesting: 10,000 × 15% = 1,500;
    // with: 6,000 × 15% = 900. Saved $600.
    expect(r.taxableLongTermGain.toNumber()).toBe(6000);
    expect(r.taxableShortTermGain.isZero()).toBe(true);
    expect(r.taxSaved.roundToCents().toNumber()).toBe(600);
  });

  it("respects the $1,500 married-filing-separately limit", () => {
    const r = taxLossHarvest({
      shortTermGain: 0,
      shortTermLoss: 5000,
      longTermGain: 0,
      longTermLoss: 0,
      ordinaryRatePct: 22,
      longTermRatePct: 15,
      ordinaryOffsetLimit: 1500,
    });
    expect(r.deductibleAgainstOrdinary.toNumber()).toBe(1500);
    expect(r.lossCarryforward.toNumber()).toBe(3500);
    expect(r.taxSaved.roundToCents().toNumber()).toBe(330); // 1,500 × 22%
  });

  it("two gains with no losses save nothing", () => {
    const r = taxLossHarvest({
      shortTermGain: 5000,
      shortTermLoss: 0,
      longTermGain: 8000,
      longTermLoss: 0,
      ordinaryRatePct: 24,
      longTermRatePct: 15,
      ordinaryOffsetLimit: 3000,
    });
    expect(r.taxableShortTermGain.toNumber()).toBe(5000);
    expect(r.taxableLongTermGain.toNumber()).toBe(8000);
    expect(r.taxSaved.isZero()).toBe(true);
  });
});

describe("Roth conversion ladder", () => {
  it("seasons each conversion five years and forms a steady stream", () => {
    const r = rothConversionLadder({
      startYear: 2026,
      annualConversion: 40000,
      ladderYears: 5,
      ordinaryRatePct: 12,
      seasoningYears: 5,
    });
    expect(r.rungs).toHaveLength(5);
    expect(r.rungs[0]!.year).toBe(2026);
    expect(r.rungs[0]!.accessibleYear).toBe(2031);
    expect(r.rungs[4]!.year).toBe(2030);
    expect(r.rungs[4]!.accessibleYear).toBe(2035);
    expect(r.firstAccessibleYear).toBe(2031);
    expect(r.annualAccessibleAmount.toNumber()).toBe(40000);
    expect(r.totalConverted.toNumber()).toBe(200000);
    // 40,000 × 12% × 5 years.
    expect(r.totalEstimatedTax.roundToCents().toNumber()).toBe(24000);
    expect(r.rungs[0]!.estimatedTax.roundToCents().toNumber()).toBe(4800);
  });

  it("handles a zero-year ladder as empty", () => {
    const r = rothConversionLadder({
      startYear: 2026,
      annualConversion: 30000,
      ladderYears: 0,
      ordinaryRatePct: 22,
      seasoningYears: 5,
    });
    expect(r.rungs).toHaveLength(0);
    expect(r.totalConverted.isZero()).toBe(true);
    expect(r.totalEstimatedTax.isZero()).toBe(true);
  });
});

describe("backdoor Roth (pro-rata rule)", () => {
  it("is fully tax-free with no pre-tax IRA balance", () => {
    const r = backdoorRoth({ contribution: 7000, pretaxIraBalance: 0, ordinaryRatePct: 24 });
    expect(r.isClean).toBe(true);
    expect(r.taxableFraction).toBe(0);
    expect(r.taxablePortion.isZero()).toBe(true);
    expect(r.nontaxablePortion.toNumber()).toBe(7000);
    expect(r.taxOwed.isZero()).toBe(true);
  });

  it("taxes the conversion pro-rata when pre-tax balances exist", () => {
    const r = backdoorRoth({ contribution: 7000, pretaxIraBalance: 30000, ordinaryRatePct: 24 });
    // taxable fraction = 30,000 / 37,000; taxable portion = 7,000 × that = $5,675.6757…
    expect(r.isClean).toBe(false);
    expect(r.taxableFraction).toBeCloseTo(30000 / 37000, 10);
    expect(r.taxablePortion.roundToCents().toNumber()).toBe(5675.68);
    expect(r.nontaxablePortion.roundToCents().toNumber()).toBe(1324.32);
    // tax owed = 5,675.6757… × 24% = $1,362.16
    expect(r.taxOwed.roundToCents().toNumber()).toBe(1362.16);
  });
});

describe("mega-backdoor Roth (after-tax 401k room)", () => {
  it("is the §415(c) limit less deferrals and employer contributions", () => {
    const r = megaBackdoorRoth({
      definedContributionLimit: 69000,
      electiveDeferral: 23000,
      employerContributions: 10000,
    });
    expect(r.afterTaxRoom.toNumber()).toBe(36000); // 69,000 − 23,000 − 10,000
  });

  it("never goes negative when the limit is already used up", () => {
    const r = megaBackdoorRoth({
      definedContributionLimit: 69000,
      electiveDeferral: 50000,
      employerContributions: 30000,
    });
    expect(r.afterTaxRoom.isZero()).toBe(true);
  });
});
