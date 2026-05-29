import { describe, it, expect, beforeAll } from "vitest";
import { evaluateTaxes } from "../../src/engine/tax";
import type { Jurisdiction } from "../../src/data/schemas";
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
