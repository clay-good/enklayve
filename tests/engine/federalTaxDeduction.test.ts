import { describe, it, expect, beforeAll } from "vitest";
import { evaluateTaxes } from "../../src/engine/tax";
import { JurisdictionSchema, type Jurisdiction } from "../../src/data/schemas";
import { loadDatasets, type Datasets } from "../helpers/datasets";

/**
 * Federal-tax-deduction capability (the Alabama / Oregon "federal tax paid"
 * subtraction). Built against synthetic jurisdictions — no shard ships yet — so
 * the engine is ready the moment verified state data lands (per the SPEC-3 §4.10
 * "deepen the state engine" note and the README roadmap). Two real shapes:
 *
 *  - **uncapped** (Alabama, Ala. Code §40-18-15(a)(1)): the whole federal
 *    liability is deductible;
 *  - **capped + AGI-phased** (Oregon, ORS §316.680/§316.695): the subtraction is
 *    capped and the cap phases out linearly with federal AGI.
 *
 * The synthetic states use round rates and zero standard deduction/exemption so
 * the deduction's effect is isolated and most assertions are exact to the cent,
 * independent of the (real) federal figure.
 */
let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

const num = (m: { toNumber(): number }): number => m.toNumber();
const cents = (m: { roundToCents(): { toString(): string } }): string =>
  m.roundToCents().toString();

/** Alabama-like: flat 5%, no deduction/exemption, full federal tax deductible. */
const ALABAMIA: Jurisdiction = {
  id: "US-ZA",
  name: "Alabamia",
  taxYear: 2026,
  hasIncomeTax: true,
  supportedFilingStatuses: ["single", "married_jointly"],
  bracketsByFilingStatus: { single: [{ lowerBound: 0, rate: 0.05 }] },
  standardDeductionByFilingStatus: { single: 0 },
  federalTaxDeduction: {}, // uncapped
  citation: {
    sourceUrl: "https://example.gov/alabamia/2026",
    sourceDocument: "Alabamia Revenue Code (2026)",
    effectiveYear: 2026,
    dateRetrieved: "2026-01-01",
  },
  effectiveDateRange: { start: "2026-01-01", end: "2026-12-31" },
};

/** Oregonia-like: flat 9%, cap $8,000 single, phasing out across AGI $120k→$140k. */
const OREGONIA: Jurisdiction = {
  id: "US-ZO",
  name: "Oregonia",
  taxYear: 2026,
  hasIncomeTax: true,
  supportedFilingStatuses: ["single"],
  bracketsByFilingStatus: { single: [{ lowerBound: 0, rate: 0.09 }] },
  standardDeductionByFilingStatus: { single: 0 },
  federalTaxDeduction: {
    capByFilingStatus: { single: 8000 },
    phaseOut: { byFilingStatus: { single: { agiThreshold: 120000, agiZero: 140000 } } },
  },
  citation: {
    sourceUrl: "https://example.gov/oregonia/2026",
    sourceDocument: "Oregonia Revenue Code (2026)",
    effectiveYear: 2026,
    dateRetrieved: "2026-01-01",
  },
  effectiveDateRange: { start: "2026-01-01", end: "2026-12-31" },
};

const evalState = (state: Jurisdiction, input: Parameters<typeof evaluateTaxes>[0]) =>
  evaluateTaxes(input, { federal: ds.federal, state, fica: ds.fica });

describe("uncapped federal-tax deduction (Alabama shape)", () => {
  it("deducts the full federal income tax from state taxable income", () => {
    const r = evalState(ALABAMIA, { filingStatus: "single", wages: 100000 });
    const fedTax = num(r.federal.incomeTax);
    expect(fedTax).toBeGreaterThan(0);
    // state taxable = 100,000 − fedTax; tax = 5% of that.
    expect(num(r.state!.incomeTax)).toBeCloseTo(0.05 * (100000 - fedTax), 2);
    // The reported deduction equals the federal tax (no std/exemption here).
    expect(num(r.state!.deduction.amount)).toBeCloseTo(fedTax, 2);
    // AGI − reported deduction reconciles to the reported taxable income.
    expect(num(r.state!.taxableIncome)).toBeCloseTo(num(r.agi) - fedTax, 2);
  });
});

describe("capped + AGI-phased federal-tax deduction (Oregon shape)", () => {
  it("applies the full cap below the phase-out threshold", () => {
    // AGI 100k < 120k → full $8,000 cap; fed tax exceeds it, so $8,000 is deducted.
    const r = evalState(OREGONIA, { filingStatus: "single", wages: 100000 });
    expect(num(r.federal.incomeTax)).toBeGreaterThan(8000);
    expect(cents(r.state!.incomeTax)).toBe("8280"); // 9% × (100,000 − 8,000)
  });

  it("removes the deduction entirely at and above the zero-out AGI", () => {
    const r = evalState(OREGONIA, { filingStatus: "single", wages: 140000 });
    expect(cents(r.state!.incomeTax)).toBe("12600"); // 9% × 140,000, no deduction
  });

  it("pro-rates the cap linearly at the phase-out midpoint", () => {
    // AGI 130k is halfway through 120k→140k, so the cap is $4,000.
    const r = evalState(OREGONIA, { filingStatus: "single", wages: 130000 });
    expect(num(r.federal.incomeTax)).toBeGreaterThan(4000);
    expect(cents(r.state!.incomeTax)).toBe("11340"); // 9% × (130,000 − 4,000)
  });

  it("deducts only the federal tax when it is smaller than the cap", () => {
    // A high cap, low income: fed tax < cap, so min() picks the federal tax.
    const highCap: Jurisdiction = {
      ...OREGONIA,
      id: "US-ZH",
      federalTaxDeduction: { capByFilingStatus: { single: 50000 } },
    };
    const r = evalState(highCap, { filingStatus: "single", wages: 30000 });
    const fedTax = num(r.federal.incomeTax);
    expect(fedTax).toBeGreaterThan(0);
    expect(fedTax).toBeLessThan(50000);
    expect(num(r.state!.incomeTax)).toBeCloseTo(0.09 * (30000 - fedTax), 2);
  });
});

describe("filing-status fallback for the cap", () => {
  const byStatus: Jurisdiction = {
    ...ALABAMIA,
    id: "US-ZF",
    bracketsByFilingStatus: { single: [{ lowerBound: 0, rate: 0.1 }] },
    federalTaxDeduction: { capByFilingStatus: { single: 2000, married_jointly: 5000 } },
  };

  it("qualifying surviving spouse uses the married-jointly cap, not single", () => {
    const r = evalState(byStatus, { filingStatus: "qualifying_surviving_spouse", wages: 120000 });
    expect(num(r.federal.incomeTax)).toBeGreaterThan(5000);
    expect(cents(r.state!.incomeTax)).toBe("11500"); // 10% × (120,000 − 5,000 MFJ cap)
  });

  it("married filing separately falls back to the single cap", () => {
    const r = evalState(byStatus, { filingStatus: "married_separately", wages: 60000 });
    expect(num(r.federal.incomeTax)).toBeGreaterThan(2000);
    expect(cents(r.state!.incomeTax)).toBe("5800"); // 10% × (60,000 − 2,000 single cap)
  });
});

describe("states without the feature are untouched", () => {
  it("a jurisdiction with no federalTaxDeduction taxes plain bracket income", () => {
    const plain: Jurisdiction = {
      ...ALABAMIA,
      id: "US-ZP",
      federalTaxDeduction: undefined,
    };
    const r = evalState(plain, { filingStatus: "single", wages: 100000 });
    expect(cents(r.state!.incomeTax)).toBe("5000"); // 5% × 100,000, no deduction
  });
});

describe("boundaries", () => {
  it("zero income deducts nothing and does not crash", () => {
    const r = evalState(OREGONIA, { filingStatus: "single", wages: 0 });
    expect(r.state!.incomeTax.isZero()).toBe(true);
    expect(Number.isFinite(num(r.state!.incomeTax))).toBe(true);
  });

  it("an astronomically high AGI fully phases the cap to zero, staying finite", () => {
    const r = evalState(OREGONIA, { filingStatus: "single", wages: 1_000_000_000 });
    expect(Number.isFinite(num(r.state!.incomeTax))).toBe(true);
    // Above agiZero the cap is 0, so the whole AGI is taxed at 9%.
    expect(num(r.state!.incomeTax)).toBeCloseTo(0.09 * 1_000_000_000, 0);
  });
});

describe("schema guards", () => {
  const valid: Jurisdiction = {
    id: "US-ZS",
    name: "Schemaland",
    taxYear: 2026,
    hasIncomeTax: true,
    supportedFilingStatuses: ["single"],
    bracketsByFilingStatus: { single: [{ lowerBound: 0, rate: 0.05 }] },
    standardDeductionByFilingStatus: { single: 0 },
    citation: {
      sourceUrl: "https://example.gov/schemaland/2026",
      sourceDocument: "Schemaland Code (2026)",
      effectiveYear: 2026,
      dateRetrieved: "2026-01-01",
    },
    effectiveDateRange: { start: "2026-01-01", end: "2026-12-31" },
  };

  it("accepts an uncapped deduction and a capped+phased one", () => {
    expect(JurisdictionSchema.safeParse({ ...valid, federalTaxDeduction: {} }).success).toBe(true);
    expect(
      JurisdictionSchema.safeParse({
        ...valid,
        federalTaxDeduction: {
          capByFilingStatus: { single: 8000 },
          phaseOut: { byFilingStatus: { single: { agiThreshold: 120000, agiZero: 140000 } } },
        },
      }).success,
    ).toBe(true);
  });

  it("rejects a phase-out with no cap (an uncapped subtraction cannot phase out)", () => {
    expect(
      JurisdictionSchema.safeParse({
        ...valid,
        federalTaxDeduction: {
          phaseOut: { byFilingStatus: { single: { agiThreshold: 120000, agiZero: 140000 } } },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects a phase-out whose agiZero does not exceed agiThreshold", () => {
    expect(
      JurisdictionSchema.safeParse({
        ...valid,
        federalTaxDeduction: {
          capByFilingStatus: { single: 8000 },
          phaseOut: { byFilingStatus: { single: { agiThreshold: 140000, agiZero: 140000 } } },
        },
      }).success,
    ).toBe(false);
  });
});
