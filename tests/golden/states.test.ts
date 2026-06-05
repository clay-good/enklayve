import { describe, it, expect, beforeAll } from "vitest";
import { evaluateTaxes } from "../../src/engine/tax";
import { loadDatasets, type Datasets } from "../helpers/datasets";

/**
 * Hand-verified state and local cases (BUILD-SPEC.md §8, §9). Covers a graduated
 * state (CA, NY, DC), flat states (PA/IL/MI/GA/NC), no-income-tax states as
 * first-class records (TX, FL), special rules, and opt-in local add-ons (NYC,
 * Columbus). Each expected figure is computed by hand from the 2026 schedules.
 */
let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

const cents = (m: { roundToCents(): { toString(): string } }): string =>
  m.roundToCents().toString();

describe("graduated states", () => {
  it("California single $50k → $1,280.66 (std deduction $5,706)", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 50000 },
      { federal: ds.federal, state: ds.state("ca"), fica: ds.fica },
    );
    expect(cents(r.state!.incomeTax)).toBe("1280.66");
    // Combined: federal 3,820 + FICA 3,825 + CA 1,280.66.
    expect(cents(r.totals.totalTax)).toBe("8925.66");
    expect(cents(r.totals.takeHome)).toBe("41074.34");
    expect(r.totals.marginalRate).toBeCloseTo(0.2565, 5); // 12 + 7.65 + 6
  });

  it("New York single $100k (no NYC) → $4,859.75", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 100000 },
      { federal: ds.federal, state: ds.state("ny"), fica: ds.fica },
    );
    expect(cents(r.state!.incomeTax)).toBe("4859.75");
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

  it("DC single $60k → $2,453.50", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("dc"), fica: ds.fica },
    );
    expect(cents(r.state!.incomeTax)).toBe("2453.5");
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
    ["ga", 60000, "2395.2"], // 4.99%·(60,000 − 12,000 std)
    ["nc", 60000, "1885.28"], // 3.99%·(60,000 − 12,750 std)
    ["az", 60000, "1097.5"], // 2.5%·(60,000 − 16,100 federal std)
    ["co", 60000, "1931.6"], // 4.4%·(60,000 − 16,100 federal std)
    ["in", 60000, "1740.5"], // 2.95%·(60,000 − 1,000 exemption), no std
    ["ky", 60000, "1982.4"], // 3.5%·(60,000 − 3,360 std)
    ["ma", 60000, "2780"], // 5.0%·(60,000 − 4,400 exemption), below the surtax
    ["ms", 60000, "1668"], // 0% on first $10k of taxable, 4.0%·(51,700 − 10,000)
    ["id", 60000, "2326.7"], // 5.3%·(60,000 − 16,100 federal std), HB 40 flat
    ["la", 60000, "1413.75"], // 3.0%·(60,000 − 12,875 std), Act 11 flat (2026 indexed)
    ["ia", 60000, "1668.2"], // 3.8%·(60,000 − 16,100 federal std), SF 2442 flat
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

describe("Louisiana flat 3% with the $25,750 head-of-household deduction (2026 indexed)", () => {
  // Louisiana's standard deduction is $25,750 for MFJ *and* head of household
  // (Act 11, 2026 CPI-indexed), unlike the federal split where HoH sits below
  // MFJ — so HoH and MFJ owe the same flat 3% tax at equal income.
  it("married jointly and head of household both → $1,027.50 at $60k (60,000 − 25,750)·3%", () => {
    const mfj = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 60000 },
      { federal: ds.federal, state: ds.state("la"), fica: ds.fica },
    );
    const hoh = evaluateTaxes(
      { filingStatus: "head_of_household", wages: 60000 },
      { federal: ds.federal, state: ds.state("la"), fica: ds.fica },
    );
    expect(cents(mfj.state!.incomeTax)).toBe("1027.5");
    expect(cents(hoh.state!.incomeTax)).toBe("1027.5");
  });
});

describe("Utah taxpayer tax credit (a credit standing in for a standard deduction)", () => {
  // Utah taxes federal AGI at 4.45% (SB 60, 2026), then subtracts a nonrefundable
  // taxpayer tax credit = 6%·(federal deduction) − 1.3%·(AGI − base), floored at 0.
  it("single $60k → $2,247.23 (4.45%·60,000 − [6%·16,100 − 1.3%·(60,000−18,213)])", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("ut"), fica: ds.fica },
    );
    // 2,670 − (966 − 543.231) = 2,670 − 422.769 = 2,247.231.
    expect(cents(r.state!.incomeTax)).toBe("2247.23");
  });

  it("married jointly $60k → $1,044.46 (larger deduction and base)", () => {
    const r = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 60000 },
      { federal: ds.federal, state: ds.state("ut"), fica: ds.fica },
    );
    // 2,670 − (6%·32,200 − 1.3%·(60,000−36,426)) = 2,670 − (1,932 − 306.462).
    expect(cents(r.state!.incomeTax)).toBe("1044.46");
  });

  it("is nonrefundable: a low earner whose credit exceeds the tax owes $0", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 18000 },
      { federal: ds.federal, state: ds.state("ut"), fica: ds.fica },
    );
    // Below the base the full 6%·16,100 = 966 credit exceeds 4.45%·18,000 = 801.
    expect(r.state!.incomeTax.isZero()).toBe(true);
  });

  it("the credit phase-out lifts the state marginal rate to 5.75% (4.45% + 1.3%) in its band", () => {
    const at60 = evaluateTaxes(
      { filingStatus: "single", wages: 60000 },
      { federal: ds.federal, state: ds.state("ut"), fica: ds.fica },
    );
    const at61 = evaluateTaxes(
      { filingStatus: "single", wages: 61000 },
      { federal: ds.federal, state: ds.state("ut"), fica: ds.fica },
    );
    const deltaState = at61.state!.incomeTax.subtract(at60.state!.incomeTax);
    expect(cents(deltaState)).toBe("57.5"); // 5.75% of the extra $1,000
  });
});

describe("no-income-tax states are first-class records", () => {
  // All nine states that levy no personal income tax on wages (BUILD-SPEC.md §8):
  // TX and FL at launch, plus AK, NV, NH, SD, TN, WA, WY added as first-class
  // records so a resident of any of them sees their state by name.
  for (const code of ["tx", "fl", "ak", "nv", "nh", "sd", "tn", "wa", "wy"]) {
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

describe("Massachusetts 4% millionaire surtax (top bracket)", () => {
  it("adds the 4% surtax (9% total) on taxable income over $1,107,750", () => {
    const over = evaluateTaxes(
      { filingStatus: "single", wages: 1200000 },
      { federal: ds.federal, state: ds.state("ma"), fica: ds.fica },
    );
    // MA taxable = 1,200,000 − 4,400 exemption = 1,195,600. Below the surtax a
    // flat 5% would be 59,780; the 9% top band on the excess pushes it higher.
    const flatFive = 1195600 * 0.05;
    expect(Number(cents(over.state!.incomeTax))).toBeGreaterThan(flatFive);
    // 5%·1,107,750 + 9%·(1,195,600 − 1,107,750) = 55,387.50 + 7,906.50 = 63,294.
    expect(cents(over.state!.incomeTax)).toBe("63294");
  });
});

describe("California behavioral-health-services surtax (special rule)", () => {
  it("adds 1% on taxable income over $1,000,000", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 1100000 },
      { federal: ds.federal, state: ds.state("ca"), fica: ds.fica },
    );
    // CA taxable = 1,100,000 − 5,706 = 1,094,294; surtax = 1%·(1,094,294 − 1,000,000) = 942.94.
    const noSurtax = evaluateTaxes(
      { filingStatus: "single", wages: 1000000 },
      { federal: ds.federal, state: ds.state("ca"), fica: ds.fica },
    );
    expect(r.state!.incomeTax.greaterThan(noSurtax.state!.incomeTax)).toBe(true);
  });
});
