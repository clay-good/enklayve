import { describe, it, expect, beforeAll } from "vitest";
import {
  catchUpMustBeRoth,
  electiveDeferralCatchUp,
  electiveDeferralLimit,
  inEnhancedCatchUpWindow,
  selfEmployedPlanCeilings,
} from "../../src/engine/contributionLimits";
import { loadBundledData, type BundledData } from "../../src/data/browser";

/**
 * The catch-up a 61-year-old was not being given.
 *
 * SECURE 2.0 §109 added IRC §414(v)(2)(E)(i): a participant who attains age 60,
 * 61, 62 or 63 during the taxable year gets a larger catch-up than the age-50
 * one — $11,250 for 2026 against $8,000. The shard has carried
 * `catch_up_401k_60to63` since the 2026 limits landed, cited to Notice 2025-67,
 * and no application code read it. The schema comment even names it: the
 * notice's "other limits" are kept without being required.
 *
 * So both retirement tiles told a 61-year-old their 401(k) limit was $32,500
 * when it is $35,750, understating what they may shelter by $3,250 — on the two
 * tiles whose entire purpose is stating that limit.
 *
 * The figures below are the shipped shard's own, so a data refresh moves these
 * tests with it rather than around them.
 */
let data: BundledData;
let limits: BundledData extends never ? never : ReturnType<typeof limitsOf>;
function limitsOf(d: BundledData) {
  return d.retirementLimits()!.limits;
}
beforeAll(async () => {
  data = await loadBundledData();
  limits = limitsOf(data);
});

describe("the elective-deferral catch-up", () => {
  it("gives nobody under 50 a catch-up", () => {
    expect(electiveDeferralCatchUp(49, limits)).toBe(0);
    expect(electiveDeferralLimit(49, limits)).toBe(limits.elective_deferral_401k);
  });

  it("gives the age-50 catch-up from 50 through 59", () => {
    for (const age of [50, 55, 59]) {
      expect(electiveDeferralCatchUp(age, limits)).toBe(limits.catch_up_401k_50plus);
    }
  });

  it("gives the larger §414(v)(2)(E) catch-up at 60 through 63", () => {
    const enhanced = limits.catch_up_401k_60to63!;
    expect(enhanced).toBeGreaterThan(limits.catch_up_401k_50plus);
    for (const age of [60, 61, 62, 63]) {
      expect(electiveDeferralCatchUp(age, limits)).toBe(enhanced);
      expect(inEnhancedCatchUpWindow(age, limits)).toBe(true);
    }
    // The figure a 61-year-old was previously denied.
    expect(electiveDeferralLimit(61, limits) - electiveDeferralLimit(55, limits)).toBe(
      enhanced - limits.catch_up_401k_50plus,
    );
  });

  it("closes the window at 64 rather than running on", () => {
    // The half of this rule that costs something if it is written `age >= 60`:
    // §414(v)(2)(E)(i) reaches a participant who "would attain age 60 but not
    // age 64", so a 64-year-old is back on the ordinary catch-up. Overstating
    // it is the more expensive direction — a contribution over the limit is a
    // correction, and a 6% excise tax under §4973 if it is not fixed in time.
    expect(electiveDeferralCatchUp(64, limits)).toBe(limits.catch_up_401k_50plus);
    expect(electiveDeferralCatchUp(70, limits)).toBe(limits.catch_up_401k_50plus);
    expect(inEnhancedCatchUpWindow(64, limits)).toBe(false);
  });

  it("falls back to the age-50 catch-up when a shard does not state the figure", () => {
    // The field is optional by schema, because a year's notice may not state it
    // and a shard may predate SECURE 2.0. Absent, a 61-year-old gets the
    // ordinary catch-up rather than a zero.
    const older = { ...limits };
    delete (older as Record<string, number | undefined>).catch_up_401k_60to63;
    expect(electiveDeferralCatchUp(61, older)).toBe(limits.catch_up_401k_50plus);
    expect(inEnhancedCatchUpWindow(61, older)).toBe(false);
  });

  it("makes the catch-up Roth above the §414(v)(7) wage threshold, and not below it", () => {
    // SECURE 2.0 §603. The threshold is measured on the PRECEDING calendar
    // year's §3121(a) wages from the employer sponsoring the plan, and Notice
    // 2025-67 states it directly: "The Roth catch-up wage threshold for 2025 ...
    // is increased from $145,000 to $150,000", governing 2026. It changes no
    // limit — the catch-up is the same size — only whether that money is
    // sheltered from tax this year, which is the question the optimizer exists
    // to answer.
    const threshold = limits.roth_catch_up_wage_threshold!;
    expect(threshold).toBe(150_000);
    expect(catchUpMustBeRoth(threshold + 1, limits)).toBe(true);
    // "Exceed" is the statute's word, so the threshold itself is below the line.
    expect(catchUpMustBeRoth(threshold, limits)).toBe(false);
    expect(catchUpMustBeRoth(0, limits)).toBe(false);
  });

  it("says nothing about Roth when the shard does not carry the threshold", () => {
    const older = { ...limits };
    delete (older as Record<string, number | undefined>).roth_catch_up_wage_threshold;
    expect(catchUpMustBeRoth(1_000_000, older)).toBe(false);
  });

  it("does not produce a limit for an age that is not a number", () => {
    expect(electiveDeferralCatchUp(Number.NaN, limits)).toBe(0);
    expect(electiveDeferralLimit(Number.NaN, limits)).toBe(limits.elective_deferral_401k);
  });
});

describe("what a self-employed person may actually contribute", () => {
  /**
   * §415(c)(1) is the lesser of two limits and only the dollar one was applied.
   *
   * The Self-Employed Retirement tile added an employee deferral capped at net
   * earnings to an employer share of 20% of the same net earnings, so its
   * answer topped out at 120% of what the person earned — over
   * §415(c)(1)(B)'s "100 percent of the participant's compensation", which
   * §415(c)(3)(B) measures as their earned income. An excess contribution is a
   * correction, 10% under §4972 on the employer side, and 6% a year under
   * §4973 on what stays, so the error ran in the expensive direction on a tile
   * whose own explainer recommends the solo 401(k) "especially at
   * low-to-moderate profit".
   */
  it("never lets either plan exceed 100% of compensation", () => {
    for (const net of [1, 500, 5_000, 9_294, 20_000, 27_881, 40_000, 83_642, 400_000]) {
      const c = selfEmployedPlanCeilings(net, 45, limits);
      // The catch-up is outside §415(c) by §414(v)(3)(A)(i); at 45 there is
      // none, so the whole total is annual additions.
      expect(c.catchUp).toBe(0);
      expect(c.solo, `solo at ${net} of net earnings`).toBeLessThanOrEqual(net);
      expect(c.sep, `sep at ${net} of net earnings`).toBeLessThanOrEqual(net);
    }
  });

  it("stops at net earnings below the deferral limit, where 120% used to be offered", () => {
    // $10,000 of profit leaves $9,294 after half the SE tax. The old answer was
    // $11,152. Below the §402(g) limit the deferral alone already reaches
    // compensation, so every dollar of employer contribution costs a dollar of
    // the room it is measured against — the ceiling is net earnings, taken
    // entirely as deferral.
    const c = selfEmployedPlanCeilings(9_294, 45, limits);
    expect(c.solo).toBeCloseTo(9_294, 6);
    expect(c.employerShare).toBe(0);
    expect(c.employeeDeferral).toBeCloseTo(9_294, 6);
    expect(c.cappedByCompensation).toBe(true);
  });

  it("takes only the employer share that pays for itself just above the limit", () => {
    // $30,000 of profit leaves $27,881, just over the §402(g) limit. Each
    // dollar of employer contribution adds a dollar and removes a dollar of
    // compensation, so it pays until they meet — at half the gap. The old
    // answer was $30,076, and `min(total, netEarnings)` would have said
    // $27,881: the same error, one step smaller.
    const elective = limits.elective_deferral_401k;
    const net = 27_881;
    const c = selfEmployedPlanCeilings(net, 45, limits);
    expect(c.employerShare).toBeCloseTo((net - elective) / 2, 6);
    expect(c.solo).toBeCloseTo(elective + (net - elective) / 2, 6);
    expect(c.solo).toBeLessThan(net);
  });

  it("leaves the high earner's answer exactly where it was", () => {
    // $90,000 of profit leaves $83,642, where the compensation limb does not
    // bind at all: the full 20% employer share plus the whole §402(g) deferral
    // is well under 100% of it. A fix that moved this number would be a
    // different bug.
    const elective = limits.elective_deferral_401k;
    const c = selfEmployedPlanCeilings(83_642, 45, limits);
    expect(c.employerShare).toBeCloseTo(83_642 * 0.2, 6);
    expect(c.employeeDeferral).toBe(elective);
    expect(c.solo).toBeCloseTo(elective + 83_642 * 0.2, 6);
    expect(c.cappedByCompensation).toBe(false);
  });

  it("stands exactly on the line where the compensation limb stops binding", () => {
    // The changeover is where compensation equals the additions the two limbs
    // would otherwise allow. Standing on it is the case an arbitrary income
    // never produces, and `cappedByCompensation` is the word the tile prints
    // beside the number — so which side of the line it lands on is a sentence
    // the reader sees, not just an internal flag.
    const elective = limits.elective_deferral_401k;
    const on = selfEmployedPlanCeilings(elective, 45, limits);
    expect(on.solo).toBeCloseTo(elective, 6);
    expect(on.employerShare).toBe(0);
    expect(on.cappedByCompensation).toBe(true);
    const above = selfEmployedPlanCeilings(elective + 2, 45, limits);
    expect(above.employerShare).toBeCloseTo(1, 6);
    expect(above.solo).toBeCloseTo(elective + 1, 6);
  });

  it("adds the catch-up outside the limit, because §414(v)(3)(A)(i) puts it there", () => {
    const young = selfEmployedPlanCeilings(83_642, 45, limits);
    const older = selfEmployedPlanCeilings(83_642, 55, limits);
    expect(older.catchUp).toBe(limits.catch_up_401k_50plus);
    expect(older.solo - young.solo).toBeCloseTo(limits.catch_up_401k_50plus, 6);
  });

  it("returns zeros rather than a negative ceiling for no earnings at all", () => {
    const c = selfEmployedPlanCeilings(0, 45, limits);
    expect(c.solo).toBe(0);
    expect(c.sep).toBe(0);
    expect(selfEmployedPlanCeilings(Number.NaN, 45, limits).solo).toBe(0);
    expect(selfEmployedPlanCeilings(-5_000, 45, limits).solo).toBe(0);
  });
});
