import { describe, it, expect, beforeAll } from "vitest";
import { evaluateTaxes, steppedIncomeDeductionFor } from "../../src/engine/tax";
import { Money } from "../../src/engine/money";
import type { SteppedIncomeDeductionData } from "../../src/data/schemas";
import { loadDatasets } from "../helpers/datasets";

/**
 * IRC §163(h)(4): qualified passenger vehicle loan interest.
 *
 * The One Big Beautiful Bill Act's fifth new individual deduction (§70203), and
 * the one that hides behind the other four. It is the same shape as §224 and
 * §225 — a cap, a step-down per $1,000 of income over a threshold — and it
 * answers both of that shape's open questions the OTHER way. A file exists for
 * it because "same shape" is exactly the reasoning that would get it wrong:
 *
 *   (C)(ii) says "$200 for each $1,000 (or portion thereof)", so a filer $1
 *           over a thousand loses the whole $200 where a tipped worker in the
 *           same position loses nothing.
 *   the section says nothing about joint returns, where §224(f) and §225(e) do,
 *           so a married individual filing separately IS eligible.
 *
 * It is also not a share of wages: it is interest paid out, which is why it is
 * its own input rather than a slice of one.
 */
const CAR_LOAN: SteppedIncomeDeductionData = {
  cap: 10_000,
  capJointReturn: 10_000,
  phaseOutPerStep: 200,
  phaseOutStep: 1000,
  thresholdSingle: 100_000,
  thresholdJointReturn: 200_000,
  partialStepCounts: true,
  jointReturnOnly: false,
};

const at = (
  status: Parameters<typeof steppedIncomeDeductionFor>[1],
  amount: number,
  magi: number,
) => steppedIncomeDeductionFor(CAR_LOAN, status, amount, Money.from(magi)).toNumber();

describe("the cap", () => {
  it("deducts the whole interest below the cap", () => {
    expect(at("single", 3200, 60_000)).toBe(3200);
  });

  it("stops at $10,000 — and does not double on a joint return", () => {
    // (C)(i) says "shall not exceed $10,000" and stops. Unlike §225(b)(1) there
    // is no parenthetical for a joint return, so a couple share one ceiling.
    expect(at("single", 14_000, 60_000)).toBe(10_000);
    expect(at("married_jointly", 14_000, 60_000)).toBe(10_000);
  });

  it("reaches a married individual filing separately", () => {
    // §224(f) and §225(e) deny those two to a separate filer. §163(h)(4) carries
    // no such subsection, so a separate filer gets it — at the single threshold,
    // since the $200,000 figure is "in the case of a joint return".
    expect(at("married_separately", 4000, 60_000)).toBe(4000);
    expect(at("married_separately", 4000, 110_000)).toBe(2000);
  });

  it("is nothing for a tax year whose shard carries no rule", () => {
    // (A) runs only through taxable years beginning before January 1, 2029.
    expect(
      steppedIncomeDeductionFor(undefined, "single", 4000, Money.from(60_000)).toNumber(),
    ).toBe(0);
  });
});

describe("the phase-down counts a part-thousand", () => {
  it("takes nothing AT the threshold", () => {
    expect(at("single", 10_000, 100_000)).toBe(10_000);
    expect(at("married_jointly", 10_000, 200_000)).toBe(10_000);
  });

  it("takes the whole $200 one dollar over", () => {
    // "(or portion thereof)" — the clause §224(b)(2) does not have. A dollar of
    // income costs $200 of deduction here and nothing under §224.
    expect(at("single", 10_000, 100_001)).toBe(9800);
    expect(at("single", 10_000, 101_000)).toBe(9800);
    expect(at("single", 10_000, 101_001)).toBe(9600);
  });

  it("runs out at $150,000, and at $250,000 on a joint return", () => {
    // $10,000 ÷ $200 = 50 thousands above the threshold.
    expect(at("single", 10_000, 149_000)).toBe(200);
    expect(at("single", 10_000, 150_000)).toBe(0);
    expect(at("married_jointly", 10_000, 250_000)).toBe(0);
  });

  it("never goes below zero", () => {
    expect(at("single", 10_000, 900_000)).toBe(0);
  });

  it("phases a small payment out sooner than a capped one", () => {
    // The reduction applies to what is left after the cap, so $1,000 of interest
    // is gone by $105,000 while $10,000 of it survives to $149,000.
    expect(at("single", 1000, 105_000)).toBe(0);
    expect(at("single", 10_000, 105_000)).toBe(9000);
  });
});

describe("through the whole engine", () => {
  let ds: Awaited<ReturnType<typeof loadDatasets>>;
  beforeAll(async () => {
    ds = await loadDatasets();
  });

  it("carries the rule on the federal shard", () => {
    expect(ds.federal.vehicleLoanInterestDeduction).toEqual(CAR_LOAN);
  });

  it("lowers taxable income for a filer paying a car loan", () => {
    const ctx = { federal: ds.federal, fica: ds.fica };
    const base = { filingStatus: "single" as const, wages: 62_000 };
    const without = evaluateTaxes(base, ctx);
    const withLoan = evaluateTaxes({ ...base, vehicleLoanInterest: 2400 }, ctx);
    expect(withLoan.federal.deduction.vehicleLoanInterest.toNumber()).toBe(2400);
    expect(withLoan.federal.taxableIncome.toNumber()).toBe(
      without.federal.taxableIncome.toNumber() - 2400,
    );
  });

  it("applies whether or not the filer itemizes", () => {
    // §63(b)(7) for a filer who does not itemize; §163(a) for one who does,
    // because (A) takes this interest out of the personal interest §163(h)(1)
    // disallows. Unlike §170(p), itemizing does not forfeit it.
    const ctx = { federal: ds.federal, fica: ds.fica };
    const base = {
      filingStatus: "single" as const,
      wages: 90_000,
      vehicleLoanInterest: 2400,
      itemized: { stateAndLocalTaxes: 12_000, mortgageInterest: 14_000 },
    };
    const standard = evaluateTaxes({ ...base, deductionMode: "standard" as const }, ctx);
    const itemized = evaluateTaxes({ ...base, deductionMode: "itemized" as const }, ctx);
    expect(standard.federal.deduction.vehicleLoanInterest.toNumber()).toBe(2400);
    expect(itemized.federal.deduction.vehicleLoanInterest.toNumber()).toBe(2400);
  });

  it("does not deduct FICA, which it does not touch", () => {
    const ctx = { federal: ds.federal, fica: ds.fica };
    const base = { filingStatus: "single" as const, wages: 62_000 };
    const without = evaluateTaxes(base, ctx);
    const withLoan = evaluateTaxes({ ...base, vehicleLoanInterest: 2400 }, ctx);
    expect(withLoan.fica.total.toNumber()).toBe(without.fica.total.toNumber());
  });

  it("stacks with the other four deductions of the same Act", () => {
    const ctx = { federal: ds.federal, fica: ds.fica };
    const r = evaluateTaxes(
      {
        filingStatus: "single",
        wages: 60_000,
        qualifiedTips: 5000,
        qualifiedOvertime: 3000,
        seniorsAge65Plus: 1,
        vehicleLoanInterest: 2000,
        itemized: { charitable: 1000 },
        deductionMode: "standard",
      },
      ctx,
    );
    // §63(f) rides on the standard deduction for a filer aged 65 who takes it —
    // a separate rule from §151(d)(5)(C)'s $6,000, stacking with it, and one
    // this engine did not model until 2026-09-03.
    const standard =
      ds.federal.standardDeductionByFilingStatus.single! +
      ds.federal.agedAdditionalStandardDeduction!.perPersonUnmarried;
    expect(r.federal.taxableIncome.toNumber()).toBe(
      60_000 - standard - 1000 - 6000 - 5000 - 3000 - 2000,
    );
  });

  it("makes a $100 raise cost $200 of deduction, and says so in the marginal rate", () => {
    // The "(or portion thereof)" step is a cliff, not a slope: a filer at
    // exactly $100,000 who earns one more dollar crosses into the next thousand
    // and loses the whole $200. The engine measures the marginal rate with a
    // $100 wage probe, so at that point it reports 73.65% — 29.65% of ordinary
    // tax and FICA, plus 44% from $200 of deduction lost on $100 of income.
    //
    // That number is correct and it is startling, which is the reason for a test
    // rather than a surprise: it is the shape of the statute, and a reader who
    // sees it on the Federal Income Tax tile is being told something true about
    // the next raise. A hundred dollars later the rate is back to 29.65%.
    const ctx = { federal: ds.federal, fica: ds.fica };
    const at = (wages: number): number =>
      evaluateTaxes({ filingStatus: "single", wages, vehicleLoanInterest: 5000 }, ctx).totals
        .marginalRate;
    expect(at(100_000)).toBeCloseTo(0.7365, 4);
    expect(at(100_100)).toBeCloseTo(0.2965, 4);
    expect(at(101_000)).toBeCloseTo(0.7365, 4);
    // And below the threshold there is no step at all.
    expect(at(99_900)).toBeCloseTo(0.2965, 4);
  });

  it("changes nothing for a caller that does not mention it", () => {
    const r = evaluateTaxes(
      { filingStatus: "single", wages: 48_000 },
      { federal: ds.federal, fica: ds.fica },
    );
    expect(r.federal.deduction.vehicleLoanInterest.toNumber()).toBe(0);
  });
});
