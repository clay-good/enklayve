import { describe, it, expect, beforeAll } from "vitest";
import { adjustForInflation, availableYears } from "../../src/engine/inflation";
import { loadDatasets, type Datasets } from "../helpers/datasets";

/**
 * CPI inflation adjustment (BUILD-SPEC.md §3.4, §9). Cases are computed straight
 * from the bundled BLS CPI-U annual averages by hand, so a wrong index value or
 * a wrong formula both fail here.
 */
let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

describe("CPI inflation adjuster", () => {
  it("adjusts $100 from 2000 to 2024 dollars", () => {
    // 100 × (313.689 / 172.2) = 182.1655… → $182.17.
    const r = adjustForInflation(100, 2000, 2024, ds.cpi)!;
    expect(r).not.toBeNull();
    expect(r.adjusted.roundToCents().toNumber()).toBe(182.17);
    expect(r.totalChange).toBeCloseTo(0.821655, 5);
    // Average annual inflation over the 24-year span ≈ 2.53%.
    expect(r.annualizedRate).toBeCloseTo(0.025305, 4);
  });

  it("is a no-op for the same year", () => {
    const r = adjustForInflation(100, 2024, 2024, ds.cpi)!;
    expect(r.adjusted.roundToCents().toNumber()).toBe(100);
    expect(r.totalChange).toBe(0);
    expect(r.annualizedRate).toBe(0);
  });

  it("returns null for a year not in the dataset (never extrapolates)", () => {
    expect(adjustForInflation(100, 1800, 2024, ds.cpi)).toBeNull();
    expect(adjustForInflation(100, 2024, 2099, ds.cpi)).toBeNull();
  });

  it("exposes the available years ascending", () => {
    const years = availableYears(ds.cpi);
    expect(years[0]).toBe(1913);
    expect(years[years.length - 1]).toBe(2025);
    expect([...years]).toEqual([...years].sort((a, b) => a - b));
  });
});
