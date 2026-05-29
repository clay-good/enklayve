import { describe, it, expect, beforeAll } from "vitest";
import { Money } from "../../src/engine/money";
import { selfEmploymentTax } from "../../src/engine/tax";
import { loadDatasets, type Datasets } from "../helpers/datasets";

/**
 * Hand-verified self-employment tax cases (BUILD-SPEC.md §3.2, §9). Every
 * expected figure is computed by hand from the published 2024 FICA parameters
 * (wage base $168,600; SE rates 12.4% + 2.9% on 92.35% of net), independent of
 * the engine, so the case catches a wrong engine as much as a wrong dataset.
 */
let ds: Datasets;
beforeAll(async () => {
  ds = await loadDatasets();
});

const cents = (m: Money): string => m.roundToCents().toString();

describe("self-employment tax (2024)", () => {
  it("$50,000 net profit, single → $7,065.00", () => {
    // base = 50,000 × 0.9235 = 46,175. SS 12.4%·46,175 = 5,725.70.
    // Medicare 2.9%·46,175 = 1,339.075 → 1,339.08. total = 7,064.78.
    const r = selfEmploymentTax(Money.from(50000), "single", ds.fica);
    expect(cents(r.taxableBase)).toBe("46175");
    expect(cents(r.socialSecurity)).toBe("5725.7");
    expect(cents(r.total)).toBe("7064.78");
    // Half is deductible above the line.
    expect(cents(r.deductibleHalf)).toBe("3532.39");
    expect(r.additionalMedicare.isZero()).toBe(true);
  });

  it("caps the Social Security portion at the wage base", () => {
    // base = 250,000 × 0.9235 = 230,875 > 168,600 → SS capped at 168,600.
    // SS = 12.4%·168,600 = 20,906.40.
    const r = selfEmploymentTax(Money.from(250000), "single", ds.fica);
    expect(cents(r.socialSecurity)).toBe("20906.4");
    // Medicare still on the full base: 2.9%·230,875 = 6,695.375 → 6,695.38.
    expect(cents(r.medicare)).toBe("6695.38");
  });

  it("adds the 0.9% Additional Medicare surtax over the threshold", () => {
    // base = 250,000 × 0.9235 = 230,875. Over single threshold 200,000 by 30,875.
    // additional = 0.9%·30,875 = 277.875 → 277.88.
    const r = selfEmploymentTax(Money.from(250000), "single", ds.fica);
    expect(cents(r.additionalMedicare)).toBe("277.88");
  });

  it("is zero on no profit and never negative", () => {
    expect(selfEmploymentTax(Money.from(0), "single", ds.fica).total.isZero()).toBe(true);
    const r = selfEmploymentTax(Money.from(-5000), "single", ds.fica);
    expect(r.total.isZero()).toBe(true);
    expect(r.netEarnings.isZero()).toBe(true);
  });

  it("is deterministic", () => {
    const a = selfEmploymentTax(Money.from(80000), "married_jointly", ds.fica);
    const b = selfEmploymentTax(Money.from(80000), "married_jointly", ds.fica);
    expect(cents(a.total)).toBe(cents(b.total));
  });
});
