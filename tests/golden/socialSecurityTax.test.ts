import { describe, it, expect } from "vitest";
import {
  socialSecurityBenefitTaxation,
  type SsBenefitTaxParams,
} from "../../src/engine/socialSecurityTax";

/**
 * Taxation of Social Security benefits (IRC §86, IRS Pub. 915 Worksheet 1).
 * Hand-verified against the worksheet's three-tier rule with the statutory base
 * amounts (never inflation-adjusted): single $25,000/$34,000, married jointly
 * $32,000/$44,000. Provisional income = other income + tax-exempt interest +
 * half the benefits.
 */
const SINGLE: SsBenefitTaxParams = {
  base1: 25000,
  base2: 34000,
  tier1InclusionRate: 0.5,
  tier2InclusionRate: 0.85,
};
const JOINT: SsBenefitTaxParams = { ...SINGLE, base1: 32000, base2: 44000 };

const cents = (m: { roundToCents(): { toString(): string } }): string =>
  m.roundToCents().toString();

describe("Social Security benefit taxation (IRC §86)", () => {
  it("below the first base amount, none is taxable", () => {
    // provisional = 10,000 + 0.5·20,000 = 20,000 ≤ 25,000.
    const r = socialSecurityBenefitTaxation(
      { socialSecurityBenefits: 20000, otherIncome: 10000, taxExemptInterest: 0 },
      SINGLE,
    );
    expect(cents(r.taxableBenefits)).toBe("0");
    expect(r.percentTaxable).toBe(0);
    expect(r.tier).toBe("none");
    expect(cents(r.nonTaxableBenefits)).toBe("20000");
  });

  it("in the middle tier, the lesser of 50% of the benefit or 50% over base1 is taxable", () => {
    // provisional = 20,000 + 10,000 = 30,000 (25k < 30k ≤ 34k);
    // taxable = min(0.5·20,000, 0.5·(30,000 − 25,000)) = min(10,000, 2,500).
    const r = socialSecurityBenefitTaxation(
      { socialSecurityBenefits: 20000, otherIncome: 20000, taxExemptInterest: 0 },
      SINGLE,
    );
    expect(cents(r.taxableBenefits)).toBe("2500");
    expect(r.tier).toBe("up-to-50");
  });

  it("above the second base amount, the 85% tier blends in → $9,600 taxable", () => {
    // provisional = 30,000 + 10,000 = 40,000 (> 34,000);
    // carried = min(0.5·20,000, 0.5·9,000) = 4,500; taxable = min(0.85·20,000,
    // 0.85·(40,000 − 34,000) + 4,500) = min(17,000, 5,100 + 4,500) = 9,600.
    const r = socialSecurityBenefitTaxation(
      { socialSecurityBenefits: 20000, otherIncome: 30000, taxExemptInterest: 0 },
      SINGLE,
    );
    expect(cents(r.taxableBenefits)).toBe("9600");
    expect(r.tier).toBe("up-to-85");
    expect(r.percentTaxable).toBeCloseTo(0.48, 4);
  });

  it("a high other-income filer is capped at 85% of the benefit", () => {
    // provisional = 100,000 + 10,000 = 110,000; 0.85·(110,000 − 34,000) + 4,500
    // = 64,600 + 4,500 = 69,100, capped at 0.85·20,000 = 17,000.
    const r = socialSecurityBenefitTaxation(
      { socialSecurityBenefits: 20000, otherIncome: 100000, taxExemptInterest: 0 },
      SINGLE,
    );
    expect(cents(r.taxableBenefits)).toBe("17000");
    expect(r.percentTaxable).toBeCloseTo(0.85, 6);
  });

  it("tax-exempt interest counts toward provisional income (it can pull benefits in)", () => {
    // provisional = 22,000 + 8,000 + 0.5·20,000 = 40,000 → same as the $30k example.
    const r = socialSecurityBenefitTaxation(
      { socialSecurityBenefits: 20000, otherIncome: 22000, taxExemptInterest: 8000 },
      SINGLE,
    );
    expect(cents(r.taxableBenefits)).toBe("9600");
  });

  it("married jointly uses the higher base amounts → $40k benefit, $40k other = $19,600", () => {
    // provisional = 40,000 + 0.5·40,000 = 60,000 (> 44,000);
    // carried = min(0.5·40,000, 0.5·12,000) = 6,000; taxable = min(0.85·40,000,
    // 0.85·(60,000 − 44,000) + 6,000) = min(34,000, 13,600 + 6,000) = 19,600.
    const r = socialSecurityBenefitTaxation(
      { socialSecurityBenefits: 40000, otherIncome: 40000, taxExemptInterest: 0 },
      JOINT,
    );
    expect(cents(r.taxableBenefits)).toBe("19600");
  });

  it("zero benefits and adversarial negatives stay finite and zero", () => {
    const zero = socialSecurityBenefitTaxation(
      { socialSecurityBenefits: 0, otherIncome: 500000, taxExemptInterest: 0 },
      SINGLE,
    );
    expect(cents(zero.taxableBenefits)).toBe("0");
    expect(zero.percentTaxable).toBe(0);
    const neg = socialSecurityBenefitTaxation(
      { socialSecurityBenefits: -100, otherIncome: -100, taxExemptInterest: -100 },
      SINGLE,
    );
    expect(Number.isFinite(neg.taxableBenefits.toNumber())).toBe(true);
    expect(neg.taxableBenefits.isNegative()).toBe(false);
  });
});
