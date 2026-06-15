import { describe, it, expect, beforeAll } from "vitest";
import { estimateCapitalGains } from "../../src/engine/capitalGains";
import { loadDatasets, type Datasets } from "../helpers/datasets";

/**
 * Hand-verified capital-gains cases (BUILD-SPEC.md §3.2, §9). Long-term gains
 * are walked through the 2026 0/15/20% brackets by hand; short-term gains are
 * walked through the federal ordinary brackets; NIIT is checked against the
 * §1411 threshold test. Independent of the engine, so a wrong engine or a wrong
 * dataset both trip these.
 */
let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

const num = (m: { roundToCents(): { toNumber(): number } }): number => m.roundToCents().toNumber();

describe("long-term capital gains (2026)", () => {
  it("single, $10k LT gain stacked above the 0% ceiling → 15%", () => {
    // Ordinary 50,000 already exceeds the single 0% top of 49,450, so the whole
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
    // Ordinary 30,000 + 10,000 gain = 40,000, all below 49,450 → 0%.
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
    // Ordinary 40,000; gain 10,000 spans [40,000, 50,000]. 0% to 49,450 → 9,450
    // at 0%; 15% above → 550 × 0.15 = 82.50.
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
    expect(num(r.longTermBands[0]!.amount)).toBe(9450);
    expect(num(r.longTermBands[1]!.amount)).toBe(550);
    expect(num(r.longTermTax)).toBe(82.5);
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

describe("qualifying_surviving_spouse uses its own long-term schedule (§D1)", () => {
  it("QSS 0% band tops at $98,900, not the single $49,450", () => {
    // Ordinary 80,000; LT gain 30,000 spans [80,000, 110,000]. The QSS 0% band
    // runs to 98,900 (the married-jointly figure), so 18,900 sits at 0% and the
    // remaining 11,100 at 15% → 1,665. A single filer (0% top 49,450) would tax
    // the whole 30,000 at 15% (4,500), so this case pins the QSS-specific table
    // rather than the single fallback. MAGI is below the 250,000 QSS NIIT line.
    const r = estimateCapitalGains(
      {
        filingStatus: "qualifying_surviving_spouse",
        ordinaryTaxableIncome: 80000,
        shortTermGain: 0,
        longTermGain: 30000,
        modifiedAgi: 110000,
      },
      ds.federal,
      ds.capitalGains,
    );
    expect(r.longTermBands).toHaveLength(2);
    expect(num(r.longTermBands[0]!.amount)).toBe(18900);
    expect(r.longTermBands[0]!.rate).toBe(0);
    expect(num(r.longTermBands[1]!.amount)).toBe(11100);
    expect(num(r.longTermTax)).toBe(1665);
    expect(num(r.netInvestmentIncomeTax)).toBe(0);
  });
});

describe("long-term bracket fallback when a filing status lacks a table (§D1)", () => {
  // Pins the two-step fallback in estimateCapitalGains: a missing filing-status
  // table falls back to `single`, and a missing `single` falls back to a flat
  // 15%. These paths exist for a malformed shard; the shipped dataset has every
  // status, so they are otherwise unexercised. SPEC-3-hardening.md §D.
  it("a missing status falls back to the single schedule", () => {
    const noQss = structuredClone(ds.capitalGains);
    delete (noQss.longTermBracketsByFilingStatus as Record<string, unknown>)
      .qualifying_surviving_spouse;
    // With QSS gone, the single 0% top of 49,450 applies: ordinary 80,000 is
    // already above it, so all 30,000 is taxed at 15% → 4,500 (not the 1,665 the
    // QSS table produced for the identical input above).
    const r = estimateCapitalGains(
      {
        filingStatus: "qualifying_surviving_spouse",
        ordinaryTaxableIncome: 80000,
        shortTermGain: 0,
        longTermGain: 30000,
        modifiedAgi: 110000,
      },
      ds.federal,
      noQss,
    );
    expect(num(r.longTermTax)).toBe(4500);
  });

  it("a missing single schedule falls back to a flat 15%", () => {
    const noTables = structuredClone(ds.capitalGains);
    noTables.longTermBracketsByFilingStatus = {} as typeof noTables.longTermBracketsByFilingStatus;
    // No table for the status and none for `single` → the flat 15% default. A
    // gain of 30,000 entirely inside what would be the 0% band still taxes at
    // 15% → 4,500, proving the terminal default rather than a 0% bracket.
    const r = estimateCapitalGains(
      {
        filingStatus: "qualifying_surviving_spouse",
        ordinaryTaxableIncome: 0,
        shortTermGain: 0,
        longTermGain: 30000,
        modifiedAgi: 30000,
      },
      ds.federal,
      noTables,
    );
    expect(r.longTermBands).toHaveLength(1);
    expect(r.longTermBands[0]!.rate).toBe(0.15);
    expect(num(r.longTermTax)).toBe(4500);
  });
});

describe("short-term capital gains (ordinary rates)", () => {
  it("single, $10k ST gain stacked on $50k ordinary income → $2,160", () => {
    // The gain spans [50,000, 60,000], straddling the single 22% boundary at
    // 50,400: 400 at 12% (48) + 9,600 at 22% (2,112) = 2,160.
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
    expect(num(r.shortTermTax)).toBe(2160);
    expect(num(r.longTermTax)).toBe(0);
    expect(num(r.totalTax)).toBe(2160);
  });
});
