import { describe, it, expect, beforeAll } from "vitest";
import {
  acaApplicablePercent,
  acaCovered,
  estimatePremiumTaxCredit,
  estimateSnap,
} from "../../src/engine/benefits";
import { socialSecurityBenefitTaxation } from "../../src/engine/socialSecurityTax";
import { iraDeductibility } from "../../src/engine/iraDeduction";
import { garnishmentCeiling } from "../../src/engine/garnishment";
import { educationCredits } from "../../src/engine/educationCredits";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import type { AcaData, FilingStatus } from "../../src/data/schemas";

/**
 * Standing exactly on a statutory line.
 *
 * `npm run check:boundaries` flips each inclusive comparison in the engine to
 * its exclusive twin and reruns the suite. On 2026-08-30 forty-seven of
 * sixty-eight survived, meaning no test anywhere put a household exactly on the
 * line those comparisons draw. The baseline names the ones where "at or below"
 * is a statute rather than a defensive guard, and this file holds them.
 *
 * Every case below is written at an *exact* threshold, which is the one input an
 * arbitrary test never produces: $15,960 of income for a household of one is
 * 100.000% of the poverty line, not 99.7% or 100.4%, and the difference between
 * the two comparisons is whether that household is told it qualifies. The
 * figures are the shipped shards' own, so a data refresh that moves a threshold
 * moves these tests with it rather than around them.
 *
 * Where a comparison turns out to be *unholdable* — the two readings compute the
 * same answer — that is recorded here as a finding rather than papered over with
 * a synthetic fixture. See the education-credit block at the end.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

describe("the ACA premium tax credit at exactly 100% of the poverty line", () => {
  // 2026 HHS contiguous guideline: $15,960 for a household of one. A single
  // filer earning exactly that is at 100.000% FPL — the floor of premium-tax-
  // credit eligibility, and simultaneously the ceiling of the Medicaid gap in a
  // non-expansion state. Landing on it is the whole question.
  const ONE_PERSON_LINE = 15_960;

  it("covers a household whose income is exactly the poverty line", () => {
    const r = estimatePremiumTaxCredit(
      { householdSize: 1, annualIncome: ONE_PERSON_LINE, benchmarkMonthlyPremium: 500 },
      data.aca()!,
      data.fpl("contiguous")!,
    );
    expect(r.fplPercent).toBe(100);
    // `pct >= 100` decides this. Flipped to `>`, a filer at exactly the poverty
    // line is told they are ineligible for a credit they are entitled to, while
    // `belowMedicaidFloor` stays false — so the page would offer them nothing
    // at all, which is the worst of the four possible answers.
    expect(r.eligible).toBe(true);
    expect(r.belowMedicaidFloor).toBe(false);
    expect(r.aboveSubsidyCap).toBe(false);
    // 2.1% of income toward the benchmark, per the 0–133% band.
    expect(r.applicablePercent).toBeCloseTo(2.1, 10);
    expect(r.annualCredit.toNumber()).toBeCloseTo(500 * 12 - ONE_PERSON_LINE * 0.021, 6);
  });

  it("puts a household one dollar below the line under the Medicaid floor", () => {
    const r = estimatePremiumTaxCredit(
      { householdSize: 1, annualIncome: ONE_PERSON_LINE - 1, benchmarkMonthlyPremium: 500 },
      data.aca()!,
      data.fpl("contiguous")!,
    );
    expect(r.fplPercent).toBeLessThan(100);
    expect(r.belowMedicaidFloor).toBe(true);
    expect(r.eligible).toBe(false);
    // Recorded as it is, not as it might be: the engine still *computes* a
    // credit below the floor, and the tile prints that figure with a "heads up"
    // beside it pointing at Medicaid. `eligible` is the gate; the number is not
    // zeroed. In a non-expansion state this household is in the coverage gap
    // and entitled to neither, so the figure is arguably too encouraging.
    expect(r.annualCredit.toNumber()).toBeGreaterThan(0);
  });

  it("denies any credit at exactly 400% FPL, where the cliff returned for 2026", () => {
    // The enhanced subsidies expired after 2025, so the top band closes at 400%
    // and there is nothing above it. At exactly 400% you are above the top
    // band, not in it: the band reads `< fplHigh`.
    const r = estimatePremiumTaxCredit(
      { householdSize: 1, annualIncome: ONE_PERSON_LINE * 4, benchmarkMonthlyPremium: 800 },
      data.aca()!,
      data.fpl("contiguous")!,
    );
    expect(r.fplPercent).toBe(400);
    expect(r.aboveSubsidyCap).toBe(true);
    expect(r.eligible).toBe(false);
    expect(r.annualCredit.toNumber()).toBe(0);
    // A cent under the cliff is a real credit. This is a step, not a slope.
    const under = estimatePremiumTaxCredit(
      { householdSize: 1, annualIncome: ONE_PERSON_LINE * 4 - 1, benchmarkMonthlyPremium: 800 },
      data.aca()!,
      data.fpl("contiguous")!,
    );
    expect(under.aboveSubsidyCap).toBe(false);
    expect(under.annualCredit.toNumber()).toBeGreaterThan(0);
  });
});

describe("an open-ended top ACA band, at exactly its floor", () => {
  /**
   * The ARPA/IRA schedule that governed 2021–2025 had no cliff: its top band ran
   * from 400% FPL upward with `fplHigh: null`, capping the expected contribution
   * at 8.5% of income forever. The engine still supports that shape — the schema
   * makes `fplHigh` nullable and both `acaCovered` and `acaApplicablePercent`
   * branch on it — because it is one act of Congress away from returning, and
   * because a shard is data.
   *
   * Neither branch is reachable from the shipped 2026 table, so nothing exercised
   * them: the two `>=` comparisons inside them were unheld. A household at
   * *exactly* 400% under that schedule is the only input that tells them apart.
   */
  const ARPA: AcaData = {
    year: 2026,
    applicablePercentage: [
      { fplLow: 0, fplHigh: 150, percentageLow: 0, percentageHigh: 0 },
      { fplLow: 150, fplHigh: 400, percentageLow: 0, percentageHigh: 8.5 },
      { fplLow: 400, fplHigh: null, percentageLow: 8.5, percentageHigh: 8.5 },
    ],
    citation: {
      sourceUrl: "https://www.irs.gov/pub/irs-drop/rp-22-34.pdf",
      sourceDocument: "IRS Revenue Procedure 2022-34 (ARPA-enhanced §36B applicable percentages)",
      sourceNote:
        "Not shipped. The 2021-2025 schedule, kept here as a fixture because the engine still" +
        " supports its open-ended top band and nothing else exercises that branch.",
      effectiveYear: 2025,
      dateRetrieved: "2026-08-31",
    },
  };

  it("covers a household at exactly the open band's floor", () => {
    expect(acaCovered(400, ARPA)).toBe(true);
    expect(acaCovered(1_000, ARPA)).toBe(true);
    expect(acaCovered(399.99, ARPA)).toBe(true);
  });

  it("charges the open band's flat percentage at exactly its floor", () => {
    // Flipped to `>`, 400% FPL falls through every band and returns 0% — which
    // reads as "you owe nothing toward your premium", the opposite of the 8.5%
    // cap the band exists to impose.
    expect(acaApplicablePercent(400, ARPA)).toBe(8.5);
    expect(acaApplicablePercent(10_000, ARPA)).toBe(8.5);
  });
});

describe("the SNAP minimum benefit at a two-person household", () => {
  it("floors an eligible two-person household at the minimum benefit", () => {
    // Two people on unearned income (SSI, disability, unemployment): the
    // poverty line is $21,640 a year, so the net test allows $1,803.33 a month.
    // At $1,959 of unearned income the household clears both tests, and the
    // computed benefit — $546 max allotment less 30% of $1,750 net — is $21.
    // The statute floors one- and two-person households at $24.
    const r = estimateSnap(
      { householdSize: 2, monthlyGrossIncome: 1_959, monthlyEarnedIncome: 0 },
      data.snap()!,
      data.fpl("contiguous")!,
    );
    expect(r.eligible).toBe(true);
    expect(r.netMonthlyIncome.toNumber()).toBe(1_750);
    // `size <= 2` decides this. Flipped to `<`, a two-person household is paid
    // $21 instead of the $24 minimum — the floor would apply to single people
    // only, which is not what the rule says.
    expect(r.monthlyBenefit.toNumber()).toBe(24);
  });

  it("does not floor a three-person household", () => {
    const r = estimateSnap(
      { householdSize: 3, monthlyGrossIncome: 2_400, monthlyEarnedIncome: 0 },
      data.snap()!,
      data.fpl("contiguous")!,
    );
    expect(r.eligible).toBe(true);
    // $785 allotment less 30% of ($2,400 − $209) = $785 − $657.30 = $127.70,
    // well clear of the floor, which is why this case cannot substitute for the
    // two-person one above.
    expect(r.monthlyBenefit.toNumber()).toBeCloseTo(127.7, 6);
  });
});

describe("Social Security benefit taxation at the statutory base amounts", () => {
  // IRC §86(c): $25,000/$34,000 single, $32,000/$44,000 joint. Never indexed
  // since 1984 and 1993 respectively, so these are exact and permanent — the
  // rare thresholds a test may hard-code without going stale.
  const paramsFor = (status: FilingStatus) => {
    const d = data.socialSecurityTaxation()!;
    return {
      base1: d.base1ByFilingStatus[status]!,
      base2: d.base2ByFilingStatus[status]!,
      tier1InclusionRate: d.tier1InclusionRate,
      tier2InclusionRate: d.tier2InclusionRate,
    };
  };

  it("taxes nothing at provisional income of exactly $25,000", () => {
    // $20,000 of benefits contributes $10,000; $15,000 of other income makes
    // provisional income exactly $25,000.
    const r = socialSecurityBenefitTaxation(
      { socialSecurityBenefits: 20_000, otherIncome: 15_000, taxExemptInterest: 0 },
      paramsFor("single"),
    );
    expect(r.provisionalIncome.toNumber()).toBe(25_000);
    expect(r.taxableBenefits.toNumber()).toBe(0);
    // Both readings compute $0 here; only the tier differs, and the tier is what
    // the tile shows. Flipped to `<`, a retiree exactly at the base amount is
    // told they are in the "up to 50% taxable" tier when none of their benefit
    // is taxable at all.
    expect(r.tier).toBe("none");
    expect(r.percentTaxable).toBe(0);
  });

  it("taxes nothing at exactly $32,000 for a joint filer", () => {
    const r = socialSecurityBenefitTaxation(
      { socialSecurityBenefits: 20_000, otherIncome: 22_000, taxExemptInterest: 0 },
      paramsFor("married_jointly"),
    );
    expect(r.provisionalIncome.toNumber()).toBe(32_000);
    expect(r.tier).toBe("none");
    expect(r.taxableBenefits.toNumber()).toBe(0);
  });

  it("stays in the 50% tier at provisional income of exactly $34,000", () => {
    const r = socialSecurityBenefitTaxation(
      { socialSecurityBenefits: 20_000, otherIncome: 24_000, taxExemptInterest: 0 },
      paramsFor("single"),
    );
    expect(r.provisionalIncome.toNumber()).toBe(34_000);
    // The lesser of 50% of the benefit ($10,000) or 50% of the amount over the
    // first base (50% of $9,000 = $4,500).
    expect(r.taxableBenefits.toNumber()).toBe(4_500);
    expect(r.tier).toBe("up-to-50");
  });

  it("crosses into the 85% tier one dollar above the second base", () => {
    const r = socialSecurityBenefitTaxation(
      { socialSecurityBenefits: 20_000, otherIncome: 24_001, taxExemptInterest: 0 },
      paramsFor("single"),
    );
    expect(r.tier).toBe("up-to-85");
    expect(r.taxableBenefits.toNumber()).toBeCloseTo(4_500.85, 6);
  });

  it("counts tax-exempt interest toward the base, which is the point of it", () => {
    const r = socialSecurityBenefitTaxation(
      { socialSecurityBenefits: 20_000, otherIncome: 14_999, taxExemptInterest: 1 },
      paramsFor("single"),
    );
    expect(r.provisionalIncome.toNumber()).toBe(25_000);
    expect(r.tier).toBe("none");
  });
});

describe("the IRA deduction at the ends of its phase-out range", () => {
  const LIMITS = { ira_contribution: 7_500, ira_catch_up_50plus: 1_100 };
  const covered = {
    filingStatus: "single" as FilingStatus,
    contribution: 7_500,
    coveredByPlan: true,
    spouseCoveredByPlan: false,
    age50Plus: false,
  };

  it("gives a full deduction at exactly the bottom of the range", () => {
    const r = iraDeductibility({ ...covered, magi: 81_000 }, LIMITS, data.iraDeduction()!);
    expect(r.deductible.toNumber()).toBe(7_500);
    // Both readings deduct $7,500 — the interpolation is 100% at the low end —
    // but only one calls it "full". The tile prints that word, and "partial"
    // beside an undiminished deduction is a contradiction the reader has to
    // resolve on their own.
    expect(r.status).toBe("full");
    expect(r.nondeductibleBasis.toNumber()).toBe(0);
  });

  it("gives no deduction at exactly the top of the range", () => {
    const r = iraDeductibility({ ...covered, magi: 91_000 }, LIMITS, data.iraDeduction()!);
    expect(r.deductible.toNumber()).toBe(0);
    // Same shape at the other end: $0 either way, but "partial" here would tell
    // someone a partial deduction exists at an income where none does.
    expect(r.status).toBe("none");
    expect(r.nondeductibleBasis.toNumber()).toBe(7_500);
  });

  it("is partial one dollar inside either end", () => {
    const low = iraDeductibility({ ...covered, magi: 81_001 }, LIMITS, data.iraDeduction()!);
    expect(low.status).toBe("partial");
    // Pub 590-A rounds the partial figure up to the next $10, so a dollar over
    // the line costs nothing at all — the phase-out starts with a flat step.
    expect(low.deductible.toNumber()).toBe(7_500);
    const high = iraDeductibility({ ...covered, magi: 90_999 }, LIMITS, data.iraDeduction()!);
    expect(high.status).toBe("partial");
    // ...and ends with the $200 statutory minimum rather than a rounding tail.
    expect(high.deductible.toNumber()).toBe(200);
  });
});

describe("which garnishment test binds at the crossover", () => {
  // §1673(a): the lesser of 25% of disposable earnings or everything above
  // thirty times the federal minimum wage ($217.50 a week). The two tests agree
  // at exactly $290 of weekly disposable earnings — 25% is $72.50, and so is the
  // amount above the floor. Below $290 the floor binds; above it, the percentage.
  const weekly = (disposableEarnings: number) =>
    garnishmentCeiling(
      { disposableEarnings, payPeriod: "weekly", kind: "ordinary" },
      data.garnishmentLimits()!,
    );

  it("names the protected floor at the exact crossover", () => {
    const r = weekly(290);
    expect(r.protectedFloor.toNumber()).toBe(217.5);
    expect(r.federalMaximum!.toNumber()).toBe(72.5);
    // `aboveFloor <= byPercentage` decides only the *label*, and the label is
    // the sentence the tile shows. The module's own comment commits to giving
    // the tie to the floor, because "your earnings above $217.50 a week" is the
    // more useful half of the answer for a household at this income. Flipped to
    // `<`, that documented choice silently reverses.
    expect(r.binding).toBe("protected-floor");
  });

  it("binds on the floor below the crossover and on the percentage above it", () => {
    const below = weekly(289);
    expect(below.binding).toBe("protected-floor");
    expect(below.federalMaximum!.toNumber()).toBe(71.5);
    const above = weekly(291);
    expect(above.binding).toBe("percentage");
    expect(above.federalMaximum!.toNumber()).toBe(72.75);
  });

  it("protects earnings at exactly the floor entirely", () => {
    const r = weekly(217.5);
    expect(r.federalMaximum!.toNumber()).toBe(0);
    expect(r.binding).toBe("protected-floor");
  });
});

describe("the education-credit phase-out endpoints", () => {
  /**
   * These two comparisons are on the unheld list and **cannot be held**, which
   * is worth recording rather than forcing.
   *
   * `magi <= low` returns a fraction of 1 and `magi >= high` returns 0; the
   * interpolation in the `else` branch computes exactly the same two numbers at
   * exactly those two points. The branches are short-circuits, not decisions,
   * and no observable output distinguishes the readings — unlike the IRA
   * phase-out above, whose branches also set a `status` the reader sees.
   *
   * The behaviour is still worth pinning, so it is pinned. What is not worth
   * doing is inventing a fixture that manufactures a difference; that would
   * convert an honest "nothing depends on this" into a green check that means
   * nothing.
   */
  const single = { magi: 0, qualifiedExpenses: 4_000, married: false, aotcEligible: true };

  it("gives the full credit at exactly the bottom of the range", () => {
    const r = educationCredits({ ...single, magi: 80_000 }, data.educationCredits()!);
    expect(r.phaseOutFraction).toBe(1);
    expect(r.aotc.afterPhaseout.toNumber()).toBe(2_500);
  });

  it("gives no credit at exactly the top of the range", () => {
    const r = educationCredits({ ...single, magi: 90_000 }, data.educationCredits()!);
    expect(r.phaseOutFraction).toBe(0);
    expect(r.aotc.afterPhaseout.toNumber()).toBe(0);
    expect(r.better).toBe("none");
  });

  it("never ties, which is why the tie-break is unholdable too", () => {
    // `aotcAfter >= llcAfter` gives a tie to the AOTC, but with the statutory
    // ratios the AOTC is strictly larger at every level of expense where either
    // is positive: 100% of the first $2,000 against the LLC's 20% of the same
    // dollars. The tie-break never runs on a tie, so flipping it changes
    // nothing — a property, not a gap.
    for (const qualifiedExpenses of [1, 500, 2_000, 2_001, 4_000, 10_000, 25_000]) {
      const r = educationCredits({ ...single, qualifiedExpenses }, data.educationCredits()!);
      expect(r.aotc.afterPhaseout.toNumber()).toBeGreaterThan(r.llc.afterPhaseout.toNumber());
      expect(r.better).toBe("aotc");
    }
  });

  it("prefers the Lifetime Learning Credit when the AOTC is unavailable", () => {
    const r = educationCredits({ ...single, aotcEligible: false }, data.educationCredits()!);
    expect(r.better).toBe("llc");
    expect(r.recommendedCredit.toNumber()).toBe(800);
  });
});
