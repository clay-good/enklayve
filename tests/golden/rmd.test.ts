import { describe, it, expect, beforeAll } from "vitest";
import { requiredMinimumDistribution } from "../../src/engine/rmd";
import { loadDatasets, type Datasets } from "../helpers/datasets";

/**
 * Required Minimum Distribution (BUILD-SPEC.md §3.4, §9). Cases divide a balance
 * by the IRS Uniform Lifetime Table factor by hand, so a wrong factor or a wrong
 * formula both fail here.
 */
let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

describe("required minimum distribution (Uniform Lifetime Table)", () => {
  it("age 75, $500,000 balance → 500,000 / 24.6 = $20,325.20", () => {
    const r = requiredMinimumDistribution(75, 500000, ds.rmd);
    expect(r.required).toBe(true);
    expect(r.distributionPeriod).toBe(24.6);
    expect(r.amount.roundToCents().toNumber()).toBe(20325.2);
  });

  it("age 73 (the begin age), $1,000,000 → 1,000,000 / 26.5 = $37,735.85", () => {
    const r = requiredMinimumDistribution(73, 1000000, ds.rmd);
    expect(r.distributionPeriod).toBe(26.5);
    expect(r.amount.roundToCents().toNumber()).toBe(37735.85);
  });

  it("below the begin age, no RMD is required", () => {
    const r = requiredMinimumDistribution(70, 500000, ds.rmd);
    expect(r.required).toBe(false);
    expect(r.amount.isZero()).toBe(true);
    expect(r.beginAge).toBe(73);
  });

  it("past the top of the table uses the terminal factor (age 120 → 2.0)", () => {
    const r = requiredMinimumDistribution(130, 100000, ds.rmd);
    expect(r.distributionPeriod).toBe(2.0);
    expect(r.amount.roundToCents().toNumber()).toBe(50000);
  });
});
