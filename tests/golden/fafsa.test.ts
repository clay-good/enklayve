import { describe, it, expect, beforeAll } from "vitest";
import { estimateSai, estimatePell } from "../../src/engine/fafsa";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import type { FafsaData } from "../../src/data/schemas";

/**
 * Golden cases for the FAFSA Student Aid Index and Pell estimate (BUILD-SPEC.md
 * §4.4, §9). The SAI methodology is a published, deterministic formula; these
 * pin the formula's composition and its invariants against the bundled 2024-25
 * tables. The figures are an estimate to verify against the official SAI Formula
 * Guide — so the asserts cover the structure (monotonicity, the floor, the Pell
 * schedule) and the seeded headline figures, not a claim of audited table values.
 */
let data: BundledData;
let fafsa: FafsaData;
beforeAll(async () => {
  data = await loadBundledData();
  fafsa = data.fafsa()!;
});

const WAGE_BASE = 168600;
function sai(over: Partial<Parameters<typeof estimateSai>[0]> = {}) {
  return estimateSai(
    {
      parentIncome: 0,
      parentIncomeTax: 0,
      familySize: 4,
      lowerEarnerIncome: 0,
      parentAssets: 0,
      studentIncome: 0,
      studentIncomeTax: 0,
      studentAssets: 0,
      ssWageBase: WAGE_BASE,
      ...over,
    },
    fafsa,
  );
}

describe("FAFSA dataset (2024-25 headline figures)", () => {
  it("carries the published Pell maxima and SAI floor", () => {
    expect(fafsa.maxPellGrant).toBe(7395);
    expect(fafsa.minPellGrant).toBe(740);
    expect(fafsa.saiFloor).toBe(-1500);
  });
});

describe("estimateSai (dependent student)", () => {
  it("computes the low-income worked example to a negative SAI", () => {
    const r = sai({
      parentIncome: 45000,
      parentIncomeTax: 1500,
      familySize: 4,
      lowerEarnerIncome: 18000,
      parentAssets: 5000,
      studentIncome: 4000,
      studentAssets: 1000,
    });
    expect(r.incomeProtectionAllowance).toBe(38200);
    expect(r.employmentExpenseAllowance).toBe(4700); // capped
    expect(r.assetContribution).toBe(600);
    expect(r.sai).toBe(-293);
  });

  it("computes a middle-income family to a positive SAI", () => {
    const r = sai({
      parentIncome: 90000,
      parentIncomeTax: 7000,
      familySize: 4,
      lowerEarnerIncome: 30000,
      parentAssets: 25000,
      studentIncome: 5000,
      studentAssets: 2000,
    });
    expect(r.parentContribution).toBe(9738);
    expect(r.studentContribution).toBe(400);
    expect(r.sai).toBe(10138);
  });

  it("floors the SAI at the dataset's negative floor", () => {
    // Zero income, family of 4: allowances drive a deeply negative result.
    expect(sai({ familySize: 4 }).sai).toBe(-1500);
  });

  it("is monotonic: more parent income never lowers the SAI", () => {
    let prev = -Infinity;
    for (let income = 0; income <= 300000; income += 15000) {
      const current = sai({ parentIncome: income, parentIncomeTax: income * 0.1 }).sai;
      expect(current).toBeGreaterThanOrEqual(prev);
      prev = current;
    }
  });

  it("assesses the student's assets at 20% and protects student income", () => {
    // Student income below the protection allowance contributes nothing.
    expect(sai({ studentIncome: 5000 }).studentContribution).toBe(0);
    // $1,000 of student assets → $200.
    expect(sai({ studentAssets: 1000 }).studentContribution).toBe(200);
  });
});

describe("estimatePell (from the SAI)", () => {
  it("awards the maximum Pell at or below a zero SAI", () => {
    expect(estimatePell(0, fafsa).award.toNumber()).toBe(7395);
    expect(estimatePell(-1000, fafsa).award.toNumber()).toBe(7395);
  });

  it("reduces the award dollar-for-dollar as the SAI rises", () => {
    expect(estimatePell(2000, fafsa).award.toNumber()).toBe(5395);
  });

  it("floors an otherwise-eligible award at the minimum Pell", () => {
    expect(estimatePell(7000, fafsa).award.toNumber()).toBe(740);
  });

  it("is ineligible once the SAI reaches the maximum Pell", () => {
    const r = estimatePell(7395, fafsa);
    expect(r.eligible).toBe(false);
    expect(r.award.toNumber()).toBe(0);
  });

  it("never exceeds the maximum and falls as the SAI rises", () => {
    let prev = Infinity;
    for (let s = -1500; s <= 8000; s += 500) {
      const award = estimatePell(s, fafsa).award.toNumber();
      expect(award).toBeLessThanOrEqual(7395);
      expect(award).toBeGreaterThanOrEqual(0);
      expect(award).toBeLessThanOrEqual(prev);
      prev = award;
    }
  });
});
