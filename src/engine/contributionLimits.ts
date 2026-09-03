import type { RetirementLimitsData } from "../data/schemas";

/**
 * The elective-deferral limit for one person, given their age.
 *
 * IRC §402(g)(1) sets the base. §414(v)(2)(B)(i) adds the age-50 catch-up. And
 * §414(v)(2)(E)(i), added by SECURE 2.0 §109 and effective from 2025, replaces
 * that catch-up with a larger one for a participant who attains age 60, 61, 62
 * or 63 during the taxable year — $11,250 for 2026, against the $8,000 the same
 * person would otherwise get.
 *
 * It is a *window*, not a floor. §414(v)(2)(E)(i) reaches a participant "who
 * would attain age 60 but not age 64" in the year, so a 64-year-old goes back
 * to the ordinary age-50 catch-up. Written as `age >= 60` it would quietly
 * overstate the limit for every year after, which is the more expensive
 * direction: a contribution over the limit is a correction, a 6% excise tax
 * under §4973 if it is not withdrawn in time, and a mess with the plan.
 *
 * The shard has carried `catch_up_401k_60to63` since the 2026 limits landed,
 * cited to Notice 2025-67, and nothing read it — the schema's own comment named
 * it as one of the notice's "other limits" kept without being required. A
 * 61-year-old asking either retirement tile for their limit was told $8,000 of
 * catch-up instead of $11,250, understating what they may put away by $3,250.
 *
 * The fallback matters for the same reason the field is optional: a shard that
 * predates SECURE 2.0, or a year in which the notice states no separate figure,
 * gets the age-50 catch-up rather than a zero.
 */
export function electiveDeferralCatchUp(
  age: number,
  limits: RetirementLimitsData["limits"],
): number {
  if (!Number.isFinite(age) || age < 50) return 0;
  const ordinary = limits.catch_up_401k_50plus;
  if (age >= 60 && age < 64) return limits.catch_up_401k_60to63 ?? ordinary;
  return ordinary;
}

/** The §402(g) base plus whichever catch-up this age earns. */
export function electiveDeferralLimit(age: number, limits: RetirementLimitsData["limits"]): number {
  return limits.elective_deferral_401k + electiveDeferralCatchUp(age, limits);
}

/** True when this age is inside the §414(v)(2)(E) window and the shard states its figure. */
export function inEnhancedCatchUpWindow(
  age: number,
  limits: RetirementLimitsData["limits"],
): boolean {
  return age >= 60 && age < 64 && limits.catch_up_401k_60to63 !== undefined;
}
