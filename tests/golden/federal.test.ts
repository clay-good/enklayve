import { describe, it, expect, beforeAll } from "vitest";
import { evaluateTaxes } from "../../src/engine/tax";
import { loadDatasets, type Datasets } from "../helpers/datasets";

/**
 * Hand-verified federal income tax and FICA cases (BUILD-SPEC.md §9
 * cross-validation). Every expected figure is computed by walking the 2024
 * brackets by hand, independent of the engine, so these catch a wrong engine
 * just as much as a wrong dataset.
 */
let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

const cents = (m: { roundToCents(): { toString(): string } }): string =>
  m.roundToCents().toString();

describe("federal income tax (2024)", () => {
  it("single, $50,000 wages, standard deduction → $4,016.00", () => {
    // taxable 35,400 = 50,000 − 14,600. 10%·11,600 + 12%·23,800 = 1,160 + 2,856.
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 50000 },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(cents(r.federal.incomeTax)).toBe("4016");
    expect(r.federal.deduction).toMatchObject({ kind: "standard" });
    expect(cents(r.federal.deduction.amount)).toBe("14600");
  });

  it("married filing jointly, $100,000 wages → $8,032.00", () => {
    // taxable 70,800 = 100,000 − 29,200. 10%·23,200 + 12%·47,600.
    const r = evaluateTaxes(
      { filingStatus: "married_jointly", wages: 100000 },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(cents(r.federal.incomeTax)).toBe("8032");
  });

  it("single, $250,000 wages → $53,014.50 (into the 32% bracket)", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 250000 },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(cents(r.federal.incomeTax)).toBe("53014.5");
  });

  it("head of household uses its own schedule", () => {
    // taxable 60,000 − 21,900 = 38,100. 10%·16,550 + 12%·21,550 = 1,655 + 2,586.
    const r = evaluateTaxes(
      { filingStatus: "head_of_household", wages: 60000 },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(cents(r.federal.incomeTax)).toBe("4241");
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

describe("FICA (2024)", () => {
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
    // $250k single: SS on 168,600 = 10,453.20; Medicare 3,625; addl 0.9%·50,000 = 450.
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 250000 },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(cents(r.fica.socialSecurity)).toBe("10453.2");
    expect(cents(r.fica.medicare)).toBe("3625");
    expect(cents(r.fica.additionalMedicare)).toBe("450");
    expect(cents(r.fica.total)).toBe("14528.2");
  });
});

describe("combined federal-only result", () => {
  it("single $50k: total tax, take-home, effective and marginal rates", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 50000 },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(cents(r.totals.totalTax)).toBe("7841"); // 4,016 + 3,825
    expect(cents(r.totals.takeHome)).toBe("42159");
    expect(r.totals.effectiveRate).toBeCloseTo(0.15682, 5);
    expect(r.totals.marginalRate).toBeCloseTo(0.1965, 5); // 12% bracket + 7.65% FICA
    expect(r.federal.citation.sourceDocument).toMatch(/IRS/);
    expect(r.fica.citation.sourceDocument).toMatch(/SSA|Topic/);
  });
});
