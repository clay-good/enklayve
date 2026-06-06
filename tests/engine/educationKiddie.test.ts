import { describe, it, expect, beforeAll } from "vitest";
import { kiddieTax } from "../../src/engine/kiddieTax";
import { educationCredits } from "../../src/engine/educationCredits";
import { bracketsFor, standardDeductionFor } from "../../src/engine/tax";
import { loadBundledData, type BundledData } from "../../src/data/browser";

/**
 * SPEC-3 §4.5/§4.6 engines: the kiddie-tax stack and the AOTC-vs-LLC comparison.
 * Worked examples pin the cited 2026 figures; the boundary sweep enforces the §2.9
 * invariants (finite results, no throws over the adversarial input space).
 */
let data: BundledData;
let fed: { singleBrackets: ReturnType<typeof bracketsFor>; singleStandardDeduction: number };
beforeAll(async () => {
  data = await loadBundledData();
  const jur = data.federal()!;
  fed = {
    singleBrackets: bracketsFor(jur, "single"),
    singleStandardDeduction: standardDeductionFor(jur, "single"),
  };
});

describe("kiddieTax (IRC §1(g), 2026)", () => {
  it("stacks unearned income across the three bands", () => {
    const r = kiddieTax(
      { unearnedIncome: 8000, earnedIncome: 0, parentMarginalRate: 0.24 },
      data.kiddieTax()!,
      fed,
    );
    // std 1,350; taxable 6,650; net-unearned 5,300 at 24%; middle band 1,350 at 10%.
    expect(r.dependentStandardDeduction.toNumber()).toBe(1350);
    expect(r.amountAtParentRate.toNumber()).toBe(5300);
    expect(r.amountAtChildRate.toNumber()).toBe(1350);
    expect(r.taxAtParentRate.toNumber()).toBeCloseTo(1272, 2);
    expect(r.taxAtChildRate.toNumber()).toBeCloseTo(135, 2);
    expect(r.totalTax.toNumber()).toBeCloseTo(1407, 2);
    expect(r.subjectToKiddieTax).toBe(true);
    expect(r.effectiveRateOnUnearned).toBeCloseTo(0.1759, 3);
  });

  it("leaves income under twice the base out of the parents' band", () => {
    const r = kiddieTax(
      { unearnedIncome: 2000, earnedIncome: 0, parentMarginalRate: 0.24 },
      data.kiddieTax()!,
      fed,
    );
    expect(r.subjectToKiddieTax).toBe(false);
    expect(r.amountAtParentRate.toNumber()).toBe(0);
    expect(r.taxAtChildRate.toNumber()).toBeCloseTo(65, 2); // (2000−1350) × 10%
  });

  it("grows the dependent deduction with earned income", () => {
    const r = kiddieTax(
      { unearnedIncome: 3000, earnedIncome: 5000, parentMarginalRate: 0.22 },
      data.kiddieTax()!,
      fed,
    );
    expect(r.dependentStandardDeduction.toNumber()).toBe(5450); // 5000 + 450
    expect(r.amountAtParentRate.toNumber()).toBe(300); // 3000 − 2700
    expect(r.totalTax.toNumber()).toBeCloseTo(291, 2); // 300×0.22 + 2250×0.10
  });
});

describe("educationCredits (IRC §25A, 2026)", () => {
  it("computes the AOTC and LLC and picks the larger", () => {
    const r = educationCredits(
      { magi: 70000, married: false, qualifiedExpenses: 4000, aotcEligible: true },
      data.educationCredits()!,
    );
    expect(r.aotc.afterPhaseout.toNumber()).toBe(2500); // 100%×2000 + 25%×2000
    expect(r.aotc.refundable.toNumber()).toBe(1000); // 40%
    expect(r.llc.afterPhaseout.toNumber()).toBe(800); // 20%×4000
    expect(r.better).toBe("aotc");
    expect(r.recommendedCredit.toNumber()).toBe(2500);
  });

  it("halves both credits at the midpoint of the phase-out", () => {
    const r = educationCredits(
      { magi: 85000, married: false, qualifiedExpenses: 4000, aotcEligible: true },
      data.educationCredits()!,
    );
    expect(r.phaseOutFraction).toBeCloseTo(0.5, 5);
    expect(r.aotc.afterPhaseout.toNumber()).toBe(1250);
    expect(r.llc.afterPhaseout.toNumber()).toBe(400);
  });

  it("zeroes both above the phase-out", () => {
    const r = educationCredits(
      { magi: 95000, married: false, qualifiedExpenses: 4000, aotcEligible: true },
      data.educationCredits()!,
    );
    expect(r.better).toBe("none");
    expect(r.recommendedCredit.toNumber()).toBe(0);
  });

  it("falls back to the LLC when the AOTC isn't available", () => {
    const r = educationCredits(
      { magi: 50000, married: true, qualifiedExpenses: 10000, aotcEligible: false },
      data.educationCredits()!,
    );
    expect(r.aotc.afterPhaseout.toNumber()).toBe(0);
    expect(r.llc.afterPhaseout.toNumber()).toBe(2000); // 20%×10000, capped
    expect(r.better).toBe("llc");
  });

  it("uses the married phase-out range", () => {
    const r = educationCredits(
      { magi: 170000, married: true, qualifiedExpenses: 4000, aotcEligible: true },
      data.educationCredits()!,
    );
    expect(r.phaseOut).toEqual({ low: 160000, high: 180000 });
    expect(r.aotc.afterPhaseout.toNumber()).toBe(1250); // 2500 × 0.5
  });
});

describe("§2.9 boundary invariants — neither engine throws or returns a non-finite figure", () => {
  const probes = [0, -1, 1, 1e9, 0.5, Number.MAX_SAFE_INTEGER];
  it("kiddieTax stays finite over the boundary space", () => {
    for (const u of probes)
      for (const e of probes)
        for (const pr of [0, 0.1, 0.37, 1]) {
          const r = kiddieTax(
            { unearnedIncome: u, earnedIncome: e, parentMarginalRate: pr },
            data.kiddieTax()!,
            fed,
          );
          expect(Number.isFinite(r.totalTax.toNumber())).toBe(true);
          expect(r.totalTax.toNumber()).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(r.effectiveRateOnUnearned)).toBe(true);
        }
  });
  it("educationCredits stays finite over the boundary space", () => {
    for (const magi of probes)
      for (const exp of probes)
        for (const married of [true, false])
          for (const elig of [true, false]) {
            const r = educationCredits(
              { magi, married, qualifiedExpenses: exp, aotcEligible: elig },
              data.educationCredits()!,
            );
            expect(Number.isFinite(r.recommendedCredit.toNumber())).toBe(true);
            expect(r.recommendedCredit.toNumber()).toBeGreaterThanOrEqual(0);
            expect(Number.isFinite(r.phaseOutFraction)).toBe(true);
          }
  });
});
