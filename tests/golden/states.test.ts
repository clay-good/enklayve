import { describe, it, expect, beforeAll } from "vitest";
import { evaluateTaxes } from "../../src/engine/tax";
import { loadDatasets, type Datasets } from "../helpers/datasets";

/**
 * Hand-verified state and local cases (BUILD-SPEC.md §8, §9). Covers a graduated
 * state (CA, NY, DC), flat states (PA/IL/MI/GA/NC), no-income-tax states as
 * first-class records (TX, FL), special rules, and opt-in local add-ons (NYC,
 * Columbus). Each expected figure is computed by hand from the 2024 schedules.
 */
let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

const cents = (m: { roundToCents(): { toString(): string } }): string =>
  m.roundToCents().toString();

describe("graduated states", () => {
  it("California single $50k → $1,290.62 (std deduction $5,540)", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 50000 },
      { federal: ds.federal, state: ds.state("ca"), fica: ds.fica },
    );
    expect(cents(r.state!.incomeTax)).toBe("1290.62");
    // Combined: federal 4,016 + FICA 3,825 + CA 1,290.62.
    expect(cents(r.totals.totalTax)).toBe("9131.62");
    expect(cents(r.totals.takeHome)).toBe("40868.38");
    expect(r.totals.marginalRate).toBeCloseTo(0.2565, 5); // 12 + 7.65 + 6
  });

  it("New York single $100k (no NYC) → $4,951.75", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 100000 },
      { federal: ds.federal, state: ds.state("ny"), fica: ds.fica },
    );
    expect(cents(r.state!.incomeTax)).toBe("4951.75");
    expect(r.local.lines).toHaveLength(0);
  });

  it("New York City resident single $100k adds the local tax", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 100000, localJurisdictionIds: ["nyc"] },
      { federal: ds.federal, state: ds.state("ny"), fica: ds.fica },
    );
    expect(r.local.lines).toHaveLength(1);
    expect(r.local.lines[0]!.id).toBe("nyc");
    expect(cents(r.local.lines[0]!.tax)).toBe("3441.09");
    expect(cents(r.local.total)).toBe("3441.09");
  });

  it("DC single $60k → $2,551.00", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("dc"), fica: ds.fica },
    );
    expect(cents(r.state!.incomeTax)).toBe("2551");
  });

  it("Ohio single $60k → $933.63, plus opt-in Columbus 2.5%", () => {
    const base = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("oh"), fica: ds.fica },
    );
    expect(cents(base.state!.incomeTax)).toBe("933.63"); // 2.75%·(60,000−26,050)
    expect(base.local.lines).toHaveLength(0);

    const withCity = evaluateTaxes(
      { filingStatus: "single", wages: 60000, localJurisdictionIds: ["oh-columbus"] },
      { federal: ds.federal, state: ds.state("oh"), fica: ds.fica },
    );
    expect(cents(withCity.local.total)).toBe("1500"); // 2.5%·60,000
  });
});

describe("flat-rate states", () => {
  const cases: Array<[string, number, string]> = [
    ["pa", 60000, "1842"], // 3.07%·60,000, no deduction
    ["il", 60000, "2832.64"], // 4.95%·(60,000 − 2,775 exemption)
    ["mi", 60000, "2312"], // 4.25%·(60,000 − 5,600 exemption)
    ["ga", 60000, "2587.2"], // 5.39%·(60,000 − 12,000 std)
    ["nc", 60000, "2126.25"], // 4.5%·(60,000 − 12,750 std)
  ];
  for (const [code, wages, expected] of cases) {
    it(`${code.toUpperCase()} single $${wages.toLocaleString()} → $${expected}`, () => {
      const r = evaluateTaxes(
        { filingStatus: "single", wages },
        { federal: ds.federal, state: ds.state(code), fica: ds.fica },
      );
      expect(cents(r.state!.incomeTax)).toBe(expected);
    });
  }
});

describe("no-income-tax states are first-class records", () => {
  for (const code of ["tx", "fl"]) {
    it(`${code.toUpperCase()} levies no state or local income tax`, () => {
      const r = evaluateTaxes(
        { filingStatus: "single", wages: 80000 },
        { federal: ds.federal, state: ds.state(code), fica: ds.fica },
      );
      expect(r.state!.incomeTax.isZero()).toBe(true);
      expect(r.local.total.isZero()).toBe(true);
      // Total tax equals federal + FICA only.
      const fedOnly = evaluateTaxes(
        { filingStatus: "single", wages: 80000 },
        { federal: ds.federal, fica: ds.fica },
      );
      expect(cents(r.totals.totalTax)).toBe(cents(fedOnly.totals.totalTax));
    });
  }
});

describe("California mental-health-services surtax (special rule)", () => {
  it("adds 1% on taxable income over $1,000,000", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 1100000 },
      { federal: ds.federal, state: ds.state("ca"), fica: ds.fica },
    );
    // CA taxable = 1,100,000 − 5,540 = 1,094,460; surtax = 1%·(1,094,460 − 1,000,000) = 944.60.
    const noSurtax = evaluateTaxes(
      { filingStatus: "single", wages: 1000000 },
      { federal: ds.federal, state: ds.state("ca"), fica: ds.fica },
    );
    expect(r.state!.incomeTax.greaterThan(noSurtax.state!.incomeTax)).toBe(true);
  });
});
