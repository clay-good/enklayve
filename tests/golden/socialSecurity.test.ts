import { describe, it, expect, beforeAll } from "vitest";
import { socialSecurityBenefit, fullRetirementAgeMonths } from "../../src/engine/socialSecurity";
import { loadDatasets, type Datasets } from "../helpers/datasets";

/**
 * Social Security claiming-age adjustments (BUILD-SPEC-2 §6.7, §9). The SSA
 * worked figures: a 1960+ retiree (FRA 67) claiming at 62 takes a 30% cut; at 70
 * earns a 24% credit. Each case applies the published reduction (5/9 of 1% per
 * month for the first 36, then 5/12 of 1%) and credit (2/3 of 1% per month).
 */
let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

describe("full retirement age (SSA table)", () => {
  it("is 66y0m for births 1943–1954", () => {
    expect(fullRetirementAgeMonths(1950, ds.socialSecurity)).toBe(792);
    expect(fullRetirementAgeMonths(1954, ds.socialSecurity)).toBe(792);
  });

  it("steps up two months per year from 1955 to 1959", () => {
    expect(fullRetirementAgeMonths(1955, ds.socialSecurity)).toBe(794);
    expect(fullRetirementAgeMonths(1956, ds.socialSecurity)).toBe(796);
    expect(fullRetirementAgeMonths(1957, ds.socialSecurity)).toBe(798);
    expect(fullRetirementAgeMonths(1958, ds.socialSecurity)).toBe(800);
    expect(fullRetirementAgeMonths(1959, ds.socialSecurity)).toBe(802);
  });

  it("is 67y0m for births 1960 and later", () => {
    expect(fullRetirementAgeMonths(1960, ds.socialSecurity)).toBe(804);
    expect(fullRetirementAgeMonths(2000, ds.socialSecurity)).toBe(804);
  });
});

describe("claiming-age benefit (FRA 67, PIA $2,000)", () => {
  it("claiming at FRA pays the full PIA", () => {
    const r = socialSecurityBenefit(2000, 1960, 67, ds.socialSecurity);
    expect(r.monthsFromFra).toBe(0);
    expect(r.adjustment).toBe(0);
    expect(r.monthlyBenefit.roundToCents().toNumber()).toBe(2000);
  });

  it("claiming at 62 (60 months early) cuts the benefit 30%", () => {
    const r = socialSecurityBenefit(2000, 1960, 62, ds.socialSecurity);
    expect(r.monthsFromFra).toBe(60);
    // 36 × 5/9% + 24 × 5/12% = 20% + 10% = 30%.
    expect(r.adjustment).toBeCloseTo(-0.3, 10);
    expect(r.monthlyBenefit.roundToCents().toNumber()).toBe(1400);
  });

  it("claiming at 70 (36 months late) adds a 24% credit", () => {
    const r = socialSecurityBenefit(2000, 1960, 70, ds.socialSecurity);
    expect(r.monthsFromFra).toBe(-36);
    // 36 × 2/3% = 24%.
    expect(r.adjustment).toBeCloseTo(0.24, 10);
    expect(r.monthlyBenefit.roundToCents().toNumber()).toBe(2480);
  });
});

describe("claiming-age benefit (FRA 66, PIA $1,800)", () => {
  it("claiming at 62 (48 months early) cuts the benefit 25%", () => {
    const r = socialSecurityBenefit(1800, 1953, 62, ds.socialSecurity);
    expect(r.fraMonths).toBe(792);
    expect(r.monthsFromFra).toBe(48);
    // 36 × 5/9% + 12 × 5/12% = 20% + 5% = 25%.
    expect(r.adjustment).toBeCloseTo(-0.25, 10);
    expect(r.monthlyBenefit.roundToCents().toNumber()).toBe(1350);
  });

  it("claiming at 70 (48 months late) adds a 32% credit", () => {
    const r = socialSecurityBenefit(1800, 1953, 70, ds.socialSecurity);
    // 48 × 2/3% = 32%.
    expect(r.adjustment).toBeCloseTo(0.32, 10);
    expect(r.monthlyBenefit.roundToCents().toNumber()).toBe(2376);
  });
});

describe("bounds", () => {
  it("never accrues delayed credits past the max claiming age", () => {
    const at70 = socialSecurityBenefit(2000, 1960, 70, ds.socialSecurity);
    const at72 = socialSecurityBenefit(2000, 1960, 72, ds.socialSecurity);
    expect(at72.monthlyBenefit.toNumber()).toBe(at70.monthlyBenefit.toNumber());
  });

  it("a zero PIA pays zero at every age", () => {
    expect(socialSecurityBenefit(0, 1960, 62, ds.socialSecurity).monthlyBenefit.isZero()).toBe(
      true,
    );
    expect(socialSecurityBenefit(0, 1960, 70, ds.socialSecurity).monthlyBenefit.isZero()).toBe(
      true,
    );
  });
});
