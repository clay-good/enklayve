import { describe, it, expect, beforeAll } from "vitest";
import {
  catchUpMustBeRoth,
  electiveDeferralCatchUp,
  electiveDeferralLimit,
  inEnhancedCatchUpWindow,
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
