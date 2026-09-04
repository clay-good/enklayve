import { describe, it, expect, beforeAll } from "vitest";
import { evaluateTaxes, seniorDeductionFor } from "../../src/engine/tax";
import { Money } from "../../src/engine/money";
import type { SeniorDeductionData } from "../../src/data/schemas";
import { loadDatasets } from "../helpers/datasets";

/**
 * IRC §151(d)(5)(C), the deduction at 65.
 *
 * The One Big Beautiful Bill Act's largest new deduction for the people it
 * reaches: $6,000 for each filer aged 65 or over, reduced by 6% of modified AGI
 * over $75,000 — $150,000 on a joint return — and never below zero, for taxable
 * years beginning before 2029.
 *
 * Every number below is read off the statute, and the three readings that a
 * reasonable implementation gets wrong each have a case of their own.
 */
const RULE: SeniorDeductionData = {
  perQualifiedIndividual: 6000,
  phaseOutRate: 0.06,
  thresholdSingle: 75_000,
  thresholdJointReturn: 150_000,
};

const at = (status: Parameters<typeof seniorDeductionFor>[1], seniors: number, magi: number) =>
  seniorDeductionFor(RULE, status, seniors, Money.from(magi)).toNumber();

describe("who qualifies", () => {
  it("is nothing for a filer under 65", () => {
    expect(at("single", 0, 50_000)).toBe(0);
  });

  it("is $6,000 for one qualifying filer below the threshold", () => {
    expect(at("single", 1, 50_000)).toBe(6000);
  });

  it("counts a spouse only on a joint return", () => {
    expect(at("married_jointly", 2, 100_000)).toBe(12_000);
    // A single filer cannot have a second qualified individual, whatever is
    // passed in — clause (ii)(II) says "in the case of a joint return".
    expect(at("single", 2, 50_000)).toBe(6000);
  });

  it("is nothing at all for married filing separately", () => {
    // §151(d)(5)(C)(v): a married filer gets this ONLY on a joint return. Zero,
    // not half — which is what the SALT limitation does two paragraphs away in
    // the same Act, and is why this is worth its own case.
    expect(at("married_separately", 2, 50_000)).toBe(0);
    expect(at("married_separately", 1, 50_000)).toBe(0);
  });

  it("gives a qualifying surviving spouse one, at the single threshold", () => {
    // They file at joint RATES without filing a joint return, so clause (ii)(II)
    // does not reach a late spouse and clause (iii) uses $75,000.
    expect(at("qualifying_surviving_spouse", 2, 50_000)).toBe(6000);
    expect(at("qualifying_surviving_spouse", 1, 100_000)).toBeCloseTo(6000 - 0.06 * 25_000, 6);
  });

  it("gives a head of household one, at the single threshold", () => {
    expect(at("head_of_household", 1, 75_000)).toBe(6000);
  });
});

describe("the phase-out", () => {
  it("is untouched AT the threshold", () => {
    // "as exceeds $75,000" — a filer landing exactly on it has no excess.
    expect(at("single", 1, 75_000)).toBe(6000);
    expect(at("married_jointly", 2, 150_000)).toBe(12_000);
  });

  it("takes six cents per dollar above it", () => {
    expect(at("single", 1, 100_000)).toBeCloseTo(6000 - 0.06 * 25_000, 6);
  });

  it("reduces the PER-PERSON amount, so a couple lose twice as fast", () => {
    // (iii)(I) reduces "the $6,000 amount in clause (i)", which is per
    // individual. Reading it as a reduction of the couple's total would leave
    // them $3,000 better off at $200,000 than the statute allows.
    expect(at("married_jointly", 2, 200_000)).toBeCloseTo(2 * (6000 - 0.06 * 50_000), 6);
    expect(at("married_jointly", 2, 200_000)).toBe(6000);
  });

  it("runs out exactly where the arithmetic says, and never goes negative", () => {
    expect(at("single", 1, 175_000)).toBe(0);
    expect(at("single", 1, 174_999)).toBeGreaterThan(0);
    expect(at("married_jointly", 2, 250_000)).toBe(0);
    expect(at("married_jointly", 2, 400_000)).toBe(0);
  });

  it("is nothing for a tax year whose shard carries no rule", () => {
    // 2029 and after. Absence is an answer here, as it is for §170(p).
    expect(seniorDeductionFor(undefined, "single", 2, Money.from(50_000)).toNumber()).toBe(0);
  });
});

describe("through the whole engine", () => {
  let ds: Awaited<ReturnType<typeof loadDatasets>>;
  beforeAll(async () => {
    ds = await loadDatasets();
  });

  it("is on the federal shard with the statute's figures", () => {
    expect(ds.federal.seniorDeduction).toEqual(RULE);
  });

  it("lowers taxable income by its own amount AND by §63(f), which is a different rule", () => {
    // Turning 65 moves two deductions, not one, and this test used to know
    // about only the newer of them. §151(d)(5)(C) is the $6,000 the Act added;
    // §63(f) is the long-standing addition to the *standard* deduction, $2,050
    // for 2026 for a filer unmarried and not a surviving spouse. They stack,
    // and this engine modelled the new one and omitted the old one entirely —
    // so a 66-year-old single filer taking the standard deduction was short
    // $2,050 of deduction and paid tax on it.
    const base = { filingStatus: "single" as const, wages: 60_000 };
    const ctx = { federal: ds.federal, fica: ds.fica };
    const under = evaluateTaxes(base, ctx);
    const over = evaluateTaxes({ ...base, seniorsAge65Plus: 1 }, ctx);
    expect(over.federal.deduction.senior.toNumber()).toBe(6000);
    const aged = ds.federal.agedAdditionalStandardDeduction!.perPersonUnmarried;
    expect(aged).toBe(2050);
    expect(over.federal.taxableIncome.toNumber()).toBe(
      under.federal.taxableIncome.toNumber() - 6000 - aged,
    );
    expect(over.federal.incomeTax.lessThan(under.federal.incomeTax)).toBe(true);
  });

  it("applies whether or not the filer itemizes", () => {
    // §63(a) subtracts every allowable deduction other than the standard one for
    // an itemizer; §63(b)(2) names §151 for one who is not. Unlike §170(p), this
    // does not depend on the choice — and a test that only checked the standard
    // path would have passed against an implementation that forgot the other.
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
    expect(itemizing.federal.deduction.senior.toNumber()).toBe(6000);
    expect(itemizing.federal.taxableIncome.toNumber()).toBe(60_000 - 25_000 - 6000);
  });

  it("changes nothing for a caller that does not mention it", () => {
    // The field is optional, so every existing call site keeps its answer.
    const ctx = { federal: ds.federal, fica: ds.fica };
    const r = evaluateTaxes({ filingStatus: "single", wages: 60_000 }, ctx);
    expect(r.federal.deduction.senior.toNumber()).toBe(0);
  });
});
