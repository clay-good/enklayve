import { describe, it, expect, beforeAll } from "vitest";
import { evaluateTaxes, steppedIncomeDeductionFor } from "../../src/engine/tax";
import { Money } from "../../src/engine/money";
import type { SteppedIncomeDeductionData } from "../../src/data/schemas";
import { loadDatasets } from "../helpers/datasets";

/**
 * IRC §224 (qualified tips) and §225 (qualified overtime).
 *
 * The last two of the One Big Beautiful Bill Act's four new deductions, and the
 * two that reach the people this calculator most wants to serve: a server living
 * on tips and an hourly worker paid time-and-a-half were both being shown more
 * federal tax than they owe.
 *
 * One function serves both, because the statutes are one shape. What makes them
 * worth their own file is the phase-down, which is a STEP where the Act's other
 * two are rates — and which is not the same step the child credit uses.
 */
const TIPS: SteppedIncomeDeductionData = {
  cap: 25_000,
  capJointReturn: 25_000,
  phaseOutPerStep: 100,
  phaseOutStep: 1000,
  thresholdSingle: 150_000,
  thresholdJointReturn: 300_000,
  // §224(b)(2) and §225(b)(2) say "for each $1,000" and NOT "or portion
  // thereof"; §224(f) and §225(e) deny both to a separate filer. §163(h)(4)
  // answers each the other way, which is why they are fields.
  partialStepCounts: false,
  jointReturnOnly: true,
};
const OVERTIME: SteppedIncomeDeductionData = { ...TIPS, cap: 12_500, capJointReturn: 25_000 };

const at = (
  rule: SteppedIncomeDeductionData,
  status: Parameters<typeof steppedIncomeDeductionFor>[1],
  amount: number,
  magi: number,
) => steppedIncomeDeductionFor(rule, status, amount, Money.from(magi)).toNumber();

describe("the caps", () => {
  it("deducts the whole amount below the cap", () => {
    expect(at(TIPS, "single", 8000, 40_000)).toBe(8000);
    expect(at(OVERTIME, "single", 8000, 40_000)).toBe(8000);
  });

  it("stops at the cap", () => {
    expect(at(TIPS, "single", 90_000, 40_000)).toBe(25_000);
    expect(at(OVERTIME, "single", 90_000, 40_000)).toBe(12_500);
  });

  it("doubles the overtime cap on a joint return, and not the tips cap", () => {
    // §225(b)(1) says "$12,500 ($25,000 in the case of a joint return)". §224(b)(1)
    // says "$25,000" and stops — no joint figure at all, so a joint return gets
    // the same $25,000 a single filer does. The two sections look alike and are
    // not alike here.
    expect(at(OVERTIME, "married_jointly", 90_000, 40_000)).toBe(25_000);
    expect(at(TIPS, "married_jointly", 90_000, 40_000)).toBe(25_000);
  });

  it("is nothing for married filing separately", () => {
    // §224(f) and §225(e).
    expect(at(TIPS, "married_separately", 8000, 40_000)).toBe(0);
    expect(at(OVERTIME, "married_separately", 8000, 40_000)).toBe(0);
  });

  it("is nothing for a tax year whose shard carries no rule", () => {
    // They terminate after 2028.
    expect(
      steppedIncomeDeductionFor(undefined, "single", 8000, Money.from(40_000)).toNumber(),
    ).toBe(0);
  });
});

describe("the phase-down counts whole thousands", () => {
  it("takes nothing AT the threshold", () => {
    expect(at(TIPS, "single", 25_000, 150_000)).toBe(25_000);
    expect(at(TIPS, "married_jointly", 25_000, 300_000)).toBe(25_000);
  });

  it("takes $100 for the first completed thousand and not before", () => {
    // "$100 for each $1,000 by which ... exceeds". A filer $999 over has
    // completed no thousand.
    expect(at(TIPS, "single", 25_000, 150_999)).toBe(25_000);
    expect(at(TIPS, "single", 25_000, 151_000)).toBe(24_900);
  });

  it("does not round a part-thousand up, unlike the child credit", () => {
    // §24(b)(2) says "or fraction thereof" and §224(b)(2)(A) does not. $1,999
    // over the threshold is one completed thousand, so $100 — not $200. Reading
    // the two the same way is the mistake this case exists for.
    expect(at(TIPS, "single", 25_000, 151_999)).toBe(24_900);
    expect(at(TIPS, "single", 25_000, 152_000)).toBe(24_800);
  });

  it("never goes below zero", () => {
    expect(at(OVERTIME, "single", 12_500, 1_000_000)).toBe(0);
    expect(at(TIPS, "single", 25_000, 400_000)).toBe(0);
    expect(at(TIPS, "single", 25_000, 399_000)).toBe(100);
  });

  it("phases a small amount out sooner than a capped one", () => {
    // The reduction applies to what is left after the cap, so $2,000 of tips is
    // gone twenty thousand dollars of income before $25,000 of tips is.
    expect(at(TIPS, "single", 2000, 170_000)).toBe(0);
    expect(at(TIPS, "single", 25_000, 170_000)).toBe(23_000);
  });
});

describe("through the whole engine", () => {
  let ds: Awaited<ReturnType<typeof loadDatasets>>;
  beforeAll(async () => {
    ds = await loadDatasets();
  });

  it("carries both rules on the federal shard", () => {
    expect(ds.federal.qualifiedTipsDeduction).toEqual(TIPS);
    expect(ds.federal.qualifiedOvertimeDeduction).toEqual(OVERTIME);
  });

  it("lowers taxable income for a tipped worker", () => {
    const ctx = { federal: ds.federal, fica: ds.fica };
    const base = { filingStatus: "single" as const, wages: 48_000 };
    const without = evaluateTaxes(base, ctx);
    const withTips = evaluateTaxes({ ...base, qualifiedTips: 14_000 }, ctx);
    expect(withTips.federal.deduction.qualifiedTips.toNumber()).toBe(14_000);
    expect(withTips.federal.taxableIncome.toNumber()).toBe(
      without.federal.taxableIncome.toNumber() - 14_000,
    );
  });

  it("stacks with overtime and with the deduction at 65", () => {
    const ctx = { federal: ds.federal, fica: ds.fica };
    const r = evaluateTaxes(
      {
        filingStatus: "single",
        wages: 60_000,
        qualifiedTips: 5000,
        qualifiedOvertime: 3000,
        seniorsAge65Plus: 1,
      },
      ctx,
    );
    expect(r.federal.deduction.qualifiedTips.toNumber()).toBe(5000);
    expect(r.federal.deduction.qualifiedOvertime.toNumber()).toBe(3000);
    expect(r.federal.deduction.senior.toNumber()).toBe(6000);
    // §63(f) rides on the standard deduction for a filer aged 65 who takes it —
    // a separate rule from §151(d)(5)(C)'s $6,000, stacking with it, and one
    // this engine did not model until 2026-09-03.
    const standard =
      ds.federal.standardDeductionByFilingStatus.single! +
      ds.federal.agedAdditionalStandardDeduction!.perPersonUnmarried;
    expect(r.federal.taxableIncome.toNumber()).toBe(60_000 - standard - 5000 - 3000 - 6000);
  });

  it("does not deduct FICA, which these do not touch", () => {
    // §224 and §225 are income-tax deductions. Social Security and Medicare are
    // still owed on every tipped and overtime dollar, and a reader who saw the
    // income tax fall might reasonably assume otherwise.
    const ctx = { federal: ds.federal, fica: ds.fica };
    const base = { filingStatus: "single" as const, wages: 48_000 };
    const without = evaluateTaxes(base, ctx);
    const withTips = evaluateTaxes({ ...base, qualifiedTips: 14_000 }, ctx);
    expect(withTips.fica.total.toNumber()).toBe(without.fica.total.toNumber());
  });

  it("changes nothing for a caller that does not mention them", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 48_000 },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(r.federal.deduction.qualifiedTips.toNumber()).toBe(0);
    expect(r.federal.deduction.qualifiedOvertime.toNumber()).toBe(0);
  });
});
