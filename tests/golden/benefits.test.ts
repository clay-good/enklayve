import { describe, it, expect, beforeAll } from "vitest";
import { povertyLine, fplPercent, estimateEitc, estimateCtc } from "../../src/engine/benefits";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import type { EitcCtcData, FederalPovertyLevelData } from "../../src/data/schemas";

/**
 * Golden cases for Pillar 2 (BUILD-SPEC.md §4, §9), cross-checked against the
 * published 2024 figures (HHS poverty guidelines; IRS Rev. Proc. 2023-34 EITC;
 * IRC §24 Child Tax Credit).
 */
let data: BundledData;
let fpl: FederalPovertyLevelData;
let eitcCtc: EitcCtcData;
beforeAll(async () => {
  data = await loadBundledData();
  fpl = data.fpl("contiguous")!;
  eitcCtc = data.eitcCtc()!;
});

describe("Federal Poverty Level", () => {
  it("matches the 2024 contiguous guidelines", () => {
    expect(povertyLine(1, fpl).toNumber()).toBe(15060);
    // Household of 4: 15,060 + 5,380 × 3 = 31,200.
    expect(povertyLine(4, fpl).toNumber()).toBe(31200);
  });

  it("computes income as a percentage of the line", () => {
    // $62,400 for a household of 4 is exactly 200% FPL.
    expect(fplPercent(62400, 4, fpl)).toBeCloseTo(200, 5);
  });

  it("has Alaska and Hawaii variants higher than the contiguous base", () => {
    expect(data.fpl("alaska")!.base).toBe(18810);
    expect(data.fpl("hawaii")!.base).toBe(17310);
  });
});

describe("Earned Income Tax Credit (2024)", () => {
  it("pays the max on the plateau (1 child, $15,000)", () => {
    const r = estimateEitc({ earnedIncome: 15000, qualifyingChildren: 1, married: false }, eitcCtc);
    expect(r.credit.toNumber()).toBeCloseTo(4213, 0);
  });

  it("phases out above the threshold (1 child, $30,000 single)", () => {
    // 4,213 − (30,000 − 22,720) × 0.1598 = 4,213 − 1,163.34 ≈ 3,049.66.
    const r = estimateEitc({ earnedIncome: 30000, qualifyingChildren: 1, married: false }, eitcCtc);
    expect(r.credit.toNumber()).toBeCloseTo(3049.66, 1);
  });

  it("phases in for childless filers (0 children, $8,000)", () => {
    // min(632, 8,000 × 0.0765 = 612) = 612; below the $10,330 threshold, no phaseout.
    const r = estimateEitc({ earnedIncome: 8000, qualifyingChildren: 0, married: false }, eitcCtc);
    expect(r.credit.toNumber()).toBeCloseTo(612, 0);
  });

  it("fully phases out for childless filers by $20,000", () => {
    const r = estimateEitc({ earnedIncome: 20000, qualifyingChildren: 0, married: false }, eitcCtc);
    expect(r.credit.toNumber()).toBe(0);
    expect(r.phasedOut).toBe(true);
  });

  it("caps the bracket at three or more children", () => {
    const three = estimateEitc(
      { earnedIncome: 20000, qualifyingChildren: 3, married: false },
      eitcCtc,
    );
    const five = estimateEitc(
      { earnedIncome: 20000, qualifyingChildren: 5, married: false },
      eitcCtc,
    );
    expect(five.credit.toNumber()).toBe(three.credit.toNumber());
    expect(five.qualifyingChildren).toBe(3);
  });
});

describe("Child Tax Credit (2024)", () => {
  it("is $2,000 per child below the phaseout", () => {
    const r = estimateCtc({ qualifyingChildren: 2, magi: 100000, married: true }, eitcCtc);
    expect(r.credit.toNumber()).toBe(4000);
    // Refundable portion (ACTC) capped at $1,700 per child.
    expect(r.refundable.toNumber()).toBe(3400);
  });

  it("phases out $50 per $1,000 over the threshold", () => {
    // MFJ threshold 400k; 410k → 10 steps × $50 = $500 off 2 × $2,000.
    const r = estimateCtc({ qualifyingChildren: 2, magi: 410000, married: true }, eitcCtc);
    expect(r.credit.toNumber()).toBe(3500);
  });

  it("can phase out entirely at very high income", () => {
    const r = estimateCtc({ qualifyingChildren: 3, magi: 440000, married: false }, eitcCtc);
    expect(r.credit.toNumber()).toBe(0);
  });

  it("is deterministic", () => {
    const input = { qualifyingChildren: 2, magi: 410000, married: true };
    expect(estimateCtc(input, eitcCtc)).toEqual(estimateCtc(input, eitcCtc));
  });
});
