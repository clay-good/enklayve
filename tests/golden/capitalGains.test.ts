import { describe, it, expect, beforeAll } from "vitest";
import { estimateCapitalGains } from "../../src/engine/capitalGains";
import { loadDatasets, type Datasets } from "../helpers/datasets";

/**
 * Hand-verified capital-gains cases (BUILD-SPEC.md §3.2, §9). Long-term gains
 * are walked through the 2024 0/15/20% brackets by hand; short-term gains are
 * walked through the federal ordinary brackets; NIIT is checked against the
 * §1411 threshold test. Independent of the engine, so a wrong engine or a wrong
 * dataset both trip these.
 */
let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

const num = (m: { roundToCents(): { toNumber(): number } }): number => m.roundToCents().toNumber();

describe("long-term capital gains (2024)", () => {
  it("single, $10k LT gain stacked above the 0% ceiling → 15%", () => {
    // Ordinary 50,000 already exceeds the single 0% top of 47,025, so the whole
    // $10k long-term gain is in the 15% band: 10,000 × 0.15 = 1,500.
    const r = estimateCapitalGains(
      {
        filingStatus: "single",
        ordinaryTaxableIncome: 50000,
        shortTermGain: 0,
        longTermGain: 10000,
        modifiedAgi: 60000,
      },
      ds.federal,
      ds.capitalGains,
    );
    expect(num(r.longTermTax)).toBe(1500);
    expect(num(r.netInvestmentIncomeTax)).toBe(0);
    expect(num(r.totalTax)).toBe(1500);
    expect(r.effectiveRateOnGains).toBe(0.15);
  });

  it("single, gain entirely inside the 0% band → no tax", () => {
    // Ordinary 30,000 + 10,000 gain = 40,000, all below 47,025 → 0%.
    const r = estimateCapitalGains(
      {
        filingStatus: "single",
        ordinaryTaxableIncome: 30000,
        shortTermGain: 0,
        longTermGain: 10000,
        modifiedAgi: 40000,
      },
      ds.federal,
      ds.capitalGains,
    );
    expect(num(r.longTermTax)).toBe(0);
    expect(r.longTermBands).toHaveLength(1);
    expect(r.longTermBands[0]!.rate).toBe(0);
  });

  it("single, gain straddling the 0%/15% boundary splits into two bands", () => {
    // Ordinary 40,000; gain 10,000 spans [40,000, 50,000]. 0% to 47,025 → 7,025
    // at 0%; 15% above → 2,975 × 0.15 = 446.25.
    const r = estimateCapitalGains(
      {
        filingStatus: "single",
        ordinaryTaxableIncome: 40000,
        shortTermGain: 0,
        longTermGain: 10000,
        modifiedAgi: 50000,
      },
      ds.federal,
      ds.capitalGains,
    );
    expect(r.longTermBands).toHaveLength(2);
    expect(num(r.longTermBands[0]!.amount)).toBe(7025);
    expect(num(r.longTermBands[1]!.amount)).toBe(2975);
    expect(num(r.longTermTax)).toBe(446.25);
  });
});

describe("Net Investment Income Tax (§1411)", () => {
  it("single, MAGI $240k → 3.8% on the $40k above the $200k threshold", () => {
    // LT 50,000 sits in the 15% band → 7,500. NIIT: min(50,000, 240,000−200,000)
    // = 40,000 × 0.038 = 1,520. Total 9,020.
    const r = estimateCapitalGains(
      {
        filingStatus: "single",
        ordinaryTaxableIncome: 190000,
        shortTermGain: 0,
        longTermGain: 50000,
        modifiedAgi: 240000,
      },
      ds.federal,
      ds.capitalGains,
    );
    expect(num(r.longTermTax)).toBe(7500);
    expect(num(r.netInvestmentIncomeTax)).toBe(1520);
    expect(num(r.totalTax)).toBe(9020);
  });
});

describe("short-term capital gains (ordinary rates)", () => {
  it("single, $10k ST gain stacked on $50k ordinary income → $2,200 (22% band)", () => {
    // 50,000 and 60,000 both sit in the single 22% bracket, so the $10k gain is
    // taxed at 22% = 2,200.
    const r = estimateCapitalGains(
      {
        filingStatus: "single",
        ordinaryTaxableIncome: 50000,
        shortTermGain: 10000,
        longTermGain: 0,
        modifiedAgi: 60000,
      },
      ds.federal,
      ds.capitalGains,
    );
    expect(num(r.shortTermTax)).toBe(2200);
    expect(num(r.longTermTax)).toBe(0);
    expect(num(r.totalTax)).toBe(2200);
  });
});
