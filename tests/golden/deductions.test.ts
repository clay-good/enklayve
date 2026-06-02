import { describe, it, expect, beforeAll } from "vitest";
import { evaluateTaxes } from "../../src/engine/tax";
import { itemizedTotal } from "../../src/engine/tax/deductions";
import { Money } from "../../src/engine/money";
import { loadDatasets, type Datasets } from "../helpers/datasets";

/** Standard vs itemized (big four), SALT cap, and the medical AGI floor (§3.2). */
let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

const cents = (m: { roundToCents(): { toString(): string } }): string =>
  m.roundToCents().toString();

describe("itemizedTotal (big four)", () => {
  it("caps SALT at $10,000 and applies the 7.5% medical floor", () => {
    // SALT 20,000 → 10,000; mortgage 18,000; charitable 5,000; medical 5,000 with
    // AGI 200,000 floor 15,000 → 0. Total 33,000.
    const total = itemizedTotal(
      {
        stateAndLocalTaxes: 20000,
        mortgageInterest: 18000,
        charitable: 5000,
        medicalExpenses: 5000,
      },
      Money.from(200000),
    );
    expect(cents(total)).toBe("33000");
  });

  it("counts medical above the floor", () => {
    // AGI 100,000 floor 7,500; medical 30,000 → 22,500 deductible.
    const total = itemizedTotal({ medicalExpenses: 30000 }, Money.from(100000));
    expect(cents(total)).toBe("22500");
  });
});

describe("auto deduction picks the larger", () => {
  it("itemizes when the big four beat the standard deduction", () => {
    const r = evaluateTaxes(
      {
        filingStatus: "single",
        wages: 200000,
        itemized: { stateAndLocalTaxes: 20000, mortgageInterest: 18000, charitable: 5000 },
      },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(r.federal.deduction.kind).toBe("itemized");
    expect(cents(r.federal.deduction.amount)).toBe("33000");
    // taxable 167,000 → $32,678.00.
    expect(cents(r.federal.incomeTax)).toBe("32678");
  });

  it("falls back to the standard deduction when itemized is smaller", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 200000, itemized: { charitable: 1000 } },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(r.federal.deduction.kind).toBe("standard");
    expect(cents(r.federal.deduction.amount)).toBe("16100");
  });

  it("forced standard mode ignores larger itemized totals", () => {
    const r = evaluateTaxes(
      {
        filingStatus: "single",
        wages: 200000,
        deductionMode: "standard",
        itemized: { stateAndLocalTaxes: 20000, mortgageInterest: 18000, charitable: 5000 },
      },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(r.federal.deduction.kind).toBe("standard");
    expect(cents(r.federal.incomeTax)).toBe("36734"); // taxable 183,900
  });
});
