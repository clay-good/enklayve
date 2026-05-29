import { describe, it, expect } from "vitest";
import { fifoSelect, costBasisGain, type CostLot } from "../../src/engine/costBasis";

/**
 * Cost-basis lot picker (BUILD-SPEC.md §3.2, §9). FIFO consumes the oldest lots
 * first; the realized gain is split into short- and long-term by holding period.
 * Each case works the proceeds and basis by hand.
 */
const LOTS: CostLot[] = [
  { shares: 100, costPerShare: 10, longTerm: true }, // oldest
  { shares: 100, costPerShare: 20, longTerm: true },
  { shares: 100, costPerShare: 50, longTerm: false }, // newest, short-term
];

describe("FIFO selection", () => {
  it("consumes the oldest lots first, splitting a partial lot", () => {
    const sales = fifoSelect(LOTS, 150);
    expect(sales).toHaveLength(2);
    expect(sales[0]!.sharesSold).toBe(100); // all of lot 1
    expect(sales[1]!.sharesSold).toBe(50); // half of lot 2
  });

  it("stops once the requested shares are filled", () => {
    expect(fifoSelect(LOTS, 80)).toHaveLength(1);
  });

  it("caps at the shares available across all lots", () => {
    const sales = fifoSelect(LOTS, 999);
    expect(sales.reduce((s, x) => s + x.sharesSold, 0)).toBe(300);
  });
});

describe("realized gain by holding period", () => {
  it("computes a long-term gain selling FIFO at a higher price", () => {
    // Sell 150 shares at $60: lot1 (100 @ $10) + lot2 (50 @ $20), both long-term.
    const r = costBasisGain(60, fifoSelect(LOTS, 150));
    expect(r.sharesSold).toBe(150);
    expect(r.longTermProceeds.toNumber()).toBe(9000); // 150 × 60
    expect(r.longTermBasis.toNumber()).toBe(2000); // 100×10 + 50×20
    expect(r.longTermGain.toNumber()).toBe(7000);
    expect(r.shortTermGain.isZero()).toBe(true);
    expect(r.totalGain.toNumber()).toBe(7000);
  });

  it("separates short-term from long-term when a recent lot is sold", () => {
    // Specific-ID: sell 50 from the newest (short-term) lot only.
    const r = costBasisGain(60, [{ lot: LOTS[2]!, sharesSold: 50 }]);
    expect(r.shortTermProceeds.toNumber()).toBe(3000); // 50 × 60
    expect(r.shortTermBasis.toNumber()).toBe(2500); // 50 × 50
    expect(r.shortTermGain.toNumber()).toBe(500);
    expect(r.longTermGain.isZero()).toBe(true);
  });

  it("reports a loss as a negative gain", () => {
    // Sell the newest lot (basis $50) at $40 → a short-term loss.
    const r = costBasisGain(40, [{ lot: LOTS[2]!, sharesSold: 100 }]);
    expect(r.shortTermGain.toNumber()).toBe(-1000); // 100 × (40 − 50)
    expect(r.totalGain.toNumber()).toBe(-1000);
  });
});
