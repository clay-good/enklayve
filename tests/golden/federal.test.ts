import { describe, it, expect, beforeAll } from "vitest";
import { evaluateTaxes } from "../../src/engine/tax";
import { loadDatasets, type Datasets } from "../helpers/datasets";

/**
 * Hand-verified federal income tax and FICA cases (BUILD-SPEC.md §9
 * cross-validation). Every expected figure is computed by walking the 2026
 * brackets by hand, independent of the engine, so these catch a wrong engine
 * just as much as a wrong dataset.
 */
let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

const cents = (m: { roundToCents(): { toString(): string } }): string =>
  m.roundToCents().toString();

describe("federal income tax (2026)", () => {
  it("single, $50,000 wages, standard deduction → $3,820.00", () => {
    // taxable 33,900 = 50,000 − 16,100. 10%·12,400 + 12%·21,500 = 1,240 + 2,580.
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 50000 },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(cents(r.federal.incomeTax)).toBe("3820");
    expect(r.federal.deduction).toMatchObject({ kind: "standard" });
    expect(cents(r.federal.deduction.amount)).toBe("16100");
  });

  it("married filing jointly, $100,000 wages → $7,640.00", () => {
    // taxable 67,800 = 100,000 − 32,200. 10%·24,800 + 12%·43,000 = 2,480 + 5,160.
    const r = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 100000 },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(cents(r.federal.incomeTax)).toBe("7640");
  });

  it("single, $250,000 wages → $51,304.00 (into the 32% bracket)", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 250000 },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(cents(r.federal.incomeTax)).toBe("51304");
  });

  it("head of household uses its own schedule", () => {
    // taxable 60,000 − 24,150 = 35,850. 10%·17,700 + 12%·18,150 = 1,770 + 2,178.
    const r = evaluateTaxes(
      { filingStatus: "head_of_household", wages: 60000 },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(cents(r.federal.incomeTax)).toBe("3948");
  });

  it("zero income owes zero", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 0 },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(cents(r.federal.incomeTax)).toBe("0");
    expect(cents(r.totals.totalTax)).toBe("0");
    expect(r.totals.effectiveRate).toBe(0);
  });
});

describe("FICA (2026)", () => {
  it("$50,000 wages → SS 3,100 + Medicare 725", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 50000 },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(cents(r.fica.socialSecurity)).toBe("3100");
    expect(cents(r.fica.medicare)).toBe("725");
    expect(cents(r.fica.additionalMedicare)).toBe("0");
    expect(cents(r.fica.total)).toBe("3825");
  });

  it("caps Social Security at the wage base and adds the Additional Medicare surtax", () => {
    // $250k single: SS on 184,500 = 11,439.00; Medicare 3,625; addl 0.9%·50,000 = 450.
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 250000 },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(cents(r.fica.socialSecurity)).toBe("11439");
    expect(cents(r.fica.medicare)).toBe("3625");
    expect(cents(r.fica.additionalMedicare)).toBe("450");
    expect(cents(r.fica.total)).toBe("15514");
  });
});

describe("combined federal-only result", () => {
  it("single $50k: total tax, take-home, effective and marginal rates", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 50000 },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(cents(r.totals.totalTax)).toBe("7645"); // 3,820 + 3,825
    expect(cents(r.totals.takeHome)).toBe("42355");
    expect(r.totals.effectiveRate).toBeCloseTo(0.1529, 5);
    expect(r.totals.marginalRate).toBeCloseTo(0.1965, 5); // 12% bracket + 7.65% FICA
    expect(r.federal.citation.sourceDocument).toMatch(/IRS/);
    expect(r.fica.citation.sourceDocument).toMatch(/SSA|Topic/);
  });
});
