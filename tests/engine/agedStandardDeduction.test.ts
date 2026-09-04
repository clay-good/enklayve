import { describe, it, expect, beforeAll } from "vitest";
import { agedStandardDeductionFor } from "../../src/engine/tax";
import { evaluateTaxes } from "../../src/engine/tax";
import { loadDatasets } from "../helpers/datasets";
import type { Jurisdiction } from "../../src/data/schemas";

/**
 * IRC §63(f), the additional standard deduction for the aged.
 *
 * The older of the two deductions that turn on being 65, and the one this
 * project left out. §151(d)(5)(C) — the $6,000 the One Big Beautiful Bill Act
 * added — was modelled the day it landed; §63(f) has been in the Code for
 * decades, is stated in the same paragraph of the same revenue procedure, and
 * was modelled nowhere. A 66-year-old single filer taking the standard
 * deduction was short **$2,050** of deduction and paid tax on it.
 *
 * Three things separate it from its newer sibling, and each has a case here:
 *
 *   It is an addition to the STANDARD deduction, so an itemizer does not get
 *   it — where §151(d)(5)(C) comes off either way.
 *   The amount is LARGER for a filer unmarried and not a surviving spouse
 *   (§63(f)(3)): $2,050 against $1,650 for 2026.
 *   It has no income phase-out at all, where the $6,000 is reduced by 6% of
 *   modified AGI over $75,000.
 */
let ds: Awaited<ReturnType<typeof loadDatasets>>;
beforeAll(async () => {
  ds = await loadDatasets();
});

describe("who gets it, and how much", () => {
  it("carries the revenue procedure's two figures", () => {
    // "the additional standard deduction amount under §63(f) for the aged or
    // the blind is $1,650 ... increased to $2,050 if the individual is also
    // unmarried and not a surviving spouse" — Rev. Proc. 2025-32 §3.14(3).
    expect(ds.federal.agedAdditionalStandardDeduction).toEqual({
      perPersonMarried: 1650,
      perPersonUnmarried: 2050,
    });
  });

  it("is nothing for a filer under 65", () => {
    expect(agedStandardDeductionFor(ds.federal, "single", 0)).toBe(0);
  });

  it("gives the larger amount to one unmarried and not a surviving spouse", () => {
    expect(agedStandardDeductionFor(ds.federal, "single", 1)).toBe(2050);
    expect(agedStandardDeductionFor(ds.federal, "head_of_household", 1)).toBe(2050);
  });

  it("gives the smaller amount to a married filer, and to a surviving spouse", () => {
    // §63(f)(3)'s larger figure turns on being unmarried AND not a surviving
    // spouse, so a qualifying surviving spouse takes the married amount by
    // name — the opposite of §151(d)(5)(C), which treats them at the single
    // threshold. Two rules about the same filer that do not agree, which is
    // exactly why each is read from its own statute rather than shared.
    expect(agedStandardDeductionFor(ds.federal, "married_jointly", 1)).toBe(1650);
    expect(agedStandardDeductionFor(ds.federal, "married_separately", 1)).toBe(1650);
    expect(agedStandardDeductionFor(ds.federal, "qualifying_surviving_spouse", 1)).toBe(1650);
  });

  it("counts a second qualifying individual only where there can be one", () => {
    expect(agedStandardDeductionFor(ds.federal, "married_jointly", 2)).toBe(3300);
    // A single filer cannot have a spouse on the return, whatever is passed.
    expect(agedStandardDeductionFor(ds.federal, "single", 2)).toBe(2050);
    expect(agedStandardDeductionFor(ds.federal, "married_separately", 2)).toBe(1650);
  });

  it("is nothing for a jurisdiction that does not legislate it", () => {
    // No state does, and a state schedule without the field is not incomplete.
    const state = { ...ds.federal, agedAdditionalStandardDeduction: undefined } as Jurisdiction;
    expect(agedStandardDeductionFor(state, "single", 2)).toBe(0);
  });
});

describe("through the whole engine", () => {
  it("does not reach an itemizer, because it rides on the standard deduction", () => {
    // The property that decides where it is applied. Added after the choice
    // between standard and itemized, it would hand $2,050 to someone the
    // statute does not reach.
    const ctx = { federal: ds.federal, fica: ds.fica };
    const itemizing = evaluateTaxes(
      {
        filingStatus: "single",
        wages: 60_000,
        seniorsAge65Plus: 1,
        deductionMode: "itemized",
        itemized: { mortgageInterest: 25_000 },
      },
      ctx,
    );
    expect(itemizing.federal.deduction.kind).toBe("itemized");
    // $6,000 of §151(d)(5)(C) and none of §63(f).
    expect(itemizing.federal.taxableIncome.toNumber()).toBe(60_000 - 25_000 - 6000);
  });

  it("does not phase out with income, where the $6,000 does", () => {
    // At $200,000 the §151(d)(5)(C) deduction is entirely gone (6% of the
    // $125,000 excess exceeds $6,000). §63(f) is untouched, so the difference
    // between a 65-year-old and a 64-year-old at that income is exactly $2,050.
    const ctx = { federal: ds.federal, fica: ds.fica };
    const base = { filingStatus: "single" as const, wages: 200_000 };
    const under = evaluateTaxes(base, ctx);
    const over = evaluateTaxes({ ...base, seniorsAge65Plus: 1 }, ctx);
    expect(over.federal.deduction.senior.toNumber()).toBe(0);
    expect(under.federal.taxableIncome.toNumber() - over.federal.taxableIncome.toNumber()).toBe(
      2050,
    );
  });

  it("gives a joint return with two qualifying spouses twice the amount", () => {
    const ctx = { federal: ds.federal, fica: ds.fica };
    const base = { filingStatus: "married_jointly" as const, wages: 500_000 };
    const none = evaluateTaxes(base, ctx);
    const both = evaluateTaxes({ ...base, seniorsAge65Plus: 2 }, ctx);
    // Far past the §151(d)(5)(C) phase-out, so the whole difference is §63(f).
    expect(both.federal.deduction.senior.toNumber()).toBe(0);
    expect(none.federal.taxableIncome.toNumber() - both.federal.taxableIncome.toNumber()).toBe(
      2 * 1650,
    );
  });
});
