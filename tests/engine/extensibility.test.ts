import { describe, it, expect, beforeAll } from "vitest";
import { evaluateTaxes } from "../../src/engine/tax";
import { JurisdictionSchema, type Jurisdiction } from "../../src/data/schemas";
import { loadDatasets, type Datasets } from "../helpers/datasets";

/**
 * Extensibility invariant (BUILD-SPEC.md §8 acceptance): adding a jurisdiction
 * requires only a new data record, with no engine changes. We construct a
 * brand-new jurisdiction object here — code the evaluator has never seen — and
 * confirm it composes correctly with the real federal + FICA datasets.
 */
let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

const cents = (m: { roundToCents(): { toString(): string } }): string =>
  m.roundToCents().toString();

const TESTLANDIA: Jurisdiction = {
  id: "US-ZZ",
  name: "Testlandia",
  taxYear: 2024,
  hasIncomeTax: true,
  supportedFilingStatuses: ["single"],
  bracketsByFilingStatus: {
    single: [
      { lowerBound: 0, rate: 0.05 },
      { lowerBound: 50000, rate: 0.1 },
    ],
  },
  standardDeductionByFilingStatus: { single: 10000 },
  citation: {
    sourceUrl: "https://example.gov/testlandia/2024",
    sourceDocument: "Testlandia Revenue Code (2024)",
    effectiveYear: 2024,
    dateRetrieved: "2024-02-01",
  },
  effectiveDateRange: { start: "2024-01-01", end: "2024-12-31" },
};

describe("adding a jurisdiction is data, not code", () => {
  it("evaluates a never-before-seen jurisdiction with no engine change", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 100000 },
      { federal: ds.federal, state: TESTLANDIA, fica: ds.fica },
    );
    // taxable 90,000 = 100,000 − 10,000. 5%·50,000 + 10%·40,000 = 2,500 + 4,000.
    expect(cents(r.state!.incomeTax)).toBe("6500");
    expect(r.state!.jurisdictionName).toBe("Testlandia");
    expect(r.state!.citation.sourceDocument).toMatch(/Testlandia/);
  });

  it("treats a synthetic no-income-tax jurisdiction as first class", () => {
    const noTax: Jurisdiction = {
      ...TESTLANDIA,
      id: "US-ZY",
      name: "Calmville",
      hasIncomeTax: false,
      bracketsByFilingStatus: { single: [{ lowerBound: 0, rate: 0 }] },
      standardDeductionByFilingStatus: { single: 0 },
    };
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 100000 },
      { federal: ds.federal, state: noTax, fica: ds.fica },
    );
    expect(r.state!.incomeTax.isZero()).toBe(true);
  });
});

/** A synthetic state exercising the income-recapture capability (Arkansas's
 * bracket adjustment) in isolation: flat 10%, no deduction, a $1,000 recapture
 * ramping over $100k→$110k of taxable income. */
const RECAPTURIA: Jurisdiction = {
  ...TESTLANDIA,
  id: "US-ZR",
  name: "Recapturia",
  bracketsByFilingStatus: { single: [{ lowerBound: 0, rate: 0.1 }] },
  standardDeductionByFilingStatus: { single: 0 },
  incomeRecapture: { thresholdLow: 100000, thresholdHigh: 110000, amount: 1000 },
};

describe("high-income benefit recapture (Arkansas bracket-adjustment capability)", () => {
  const taxAt = (wages: number): string =>
    cents(
      evaluateTaxes(
        { filingStatus: "single", wages },
        { federal: ds.federal, state: RECAPTURIA, fica: ds.fica },
      ).state!.incomeTax,
    );

  it("adds nothing at or below the low threshold", () => {
    expect(taxAt(100000)).toBe("10000"); // 10%·100,000, recapture 0 at thresholdLow
  });

  it("ramps linearly through the band", () => {
    expect(taxAt(105000)).toBe("11000"); // 10,500 + 1,000·(105,000 − 100,000)/10,000
  });

  it("is the full constant amount at and above the high threshold", () => {
    expect(taxAt(110000)).toBe("12000"); // 11,000 + 1,000
    expect(taxAt(200000)).toBe("21000"); // 20,000 + 1,000
  });

  it("rejects a recapture whose high threshold does not exceed the low one", () => {
    expect(
      JurisdictionSchema.safeParse({
        ...RECAPTURIA,
        incomeRecapture: { thresholdLow: 100000, thresholdHigh: 100000, amount: 1000 },
      }).success,
    ).toBe(false);
    expect(JurisdictionSchema.safeParse(RECAPTURIA).success).toBe(true);
  });
});
