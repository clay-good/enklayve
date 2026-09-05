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

/**
 * Whether this participant's catch-up must be Roth, given prior-year wages.
 *
 * IRC §414(v)(7)(A), added by SECURE 2.0 §603: an eligible participant whose
 * §3121(a) wages "for the preceding calendar year from the employer sponsoring
 * the plan" exceed the threshold may make catch-up contributions "only if any
 * additional elective deferrals are designated Roth contributions".
 *
 * 2026 is the first year it binds. Notice 2023-62 gave an administrative
 * transition period through 2025, and Notice 2025-67 sets the threshold that
 * governs 2026 at $150,000 of 2025 wages.
 *
 * It changes no limit — the catch-up is the same size either way. What it
 * changes is whether that money is sheltered from tax this year, which is the
 * question the Retirement Contribution Optimizer exists to answer.
 */
export function catchUpMustBeRoth(
  priorYearWages: number,
  limits: RetirementLimitsData["limits"],
): boolean {
  const threshold = limits.roth_catch_up_wage_threshold;
  if (threshold === undefined || !Number.isFinite(priorYearWages)) return false;
  return priorYearWages > threshold;
}

/**
 * The employer share both self-employed plans allow: 25% of compensation,
 * which for a self-employed person works out to 20% of net earnings.
 *
 * §404(h)(1)(C) and §404(a)(3) cap the deduction at 25% of compensation, and
 * §401(c)(2) defines a self-employed person's compensation as net earnings
 * *reduced by* the contribution itself — so 25% of what is left of X after
 * taking C out of it is 20% of X. This is the rate table in Pub 560 Chapter 5,
 * stated as a number instead of looked up.
 */
const EMPLOYER_SHARE_RATE = 0.2;

/** What a self-employed person may put into each plan, and the pieces behind it. */
export interface SelfEmployedPlanCeilings {
  /** SEP-IRA: the employer share alone. */
  sep: number;
  /** Solo 401(k): the employee deferral plus the employer share it can afford. */
  solo: number;
  /** The employer contribution inside `solo`. */
  employerShare: number;
  /** The elective deferral inside `solo`, catch-up excluded. */
  employeeDeferral: number;
  /** The §414(v) catch-up this age earns, which sits outside §415(c). */
  catchUp: number;
  /**
   * True when §415(c)(1)(B) — 100% of compensation — is the binding limit
   * rather than the dollar figure, which is what happens at low profit.
   */
  cappedByCompensation: boolean;
}

/**
 * The most a self-employed person may contribute for the year, to a SEP-IRA and
 * to a solo 401(k).
 *
 * `netEarnings` is net business profit less the deductible half of
 * self-employment tax — the base every figure below is measured from.
 *
 * **§415(c)(1) has two limbs and only the dollar one was modelled.** The limit
 * on annual additions is the *lesser* of (A) the defined-contribution dollar
 * figure and (B) **"100 percent of the participant's compensation"**, and
 * §415(c)(3)(B) makes a self-employed person's compensation their earned
 * income. The Self-Employed Retirement tile applied (A) alone: it added an
 * employee deferral capped at net earnings to an employer share of 20% of the
 * same net earnings, so the answer topped out at **120% of what the person
 * earned**. At $10,000 of profit it offered a solo-401(k) ceiling of $11,152
 * against $9,294 of net earnings, and at $30,000 it offered 107.9%. Both are
 * over the limit, in the direction that costs money: an excess contribution is
 * a correction, a 10% excise tax on the employer side under §4972, and 6% a
 * year under §4973 on an excess that stays. The tile's own explainer recommends
 * the solo 401(k) "especially at low-to-moderate profit", which is the exact
 * range where it was wrong.
 *
 * **Why the answer is not simply `min(total, netEarnings)`.** Earned income is
 * net earnings reduced by the contributions made for the participant
 * (§401(c)(2), and the IRS states it the same way for one-participant plans),
 * so the employer share shrinks the very compensation the limit is measured
 * against, while elective deferrals do not — §404(n) keeps them out of the
 * deduction limit and out of its application to other contributions. The reader
 * chooses how much employer contribution to make, so the ceiling is the best
 * that choice can do:
 *
 *   compensation(E) = netEarnings − E,  deferral = min(§402(g), compensation),
 *   additions = deferral + E ≤ min(dollar limit, compensation).
 *
 * Below the §402(g) limit the deferral alone already reaches net earnings, so
 * every dollar of employer contribution costs a dollar of room and the ceiling
 * is `netEarnings` with no employer share at all. Above it, each dollar of
 * employer contribution adds a dollar and removes a dollar of compensation, so
 * it pays until the two meet — at half the gap between net earnings and the
 * deferral limit. `min(total, netEarnings)` would have said $27,881 at $30,000
 * of profit where the real ceiling is $26,190, which is the same class of error
 * one step smaller.
 *
 * The catch-up is added afterwards because §414(v)(3)(A)(i) puts it outside
 * §415(c) entirely.
 */
export function selfEmployedPlanCeilings(
  netEarnings: number,
  age: number,
  limits: RetirementLimitsData["limits"],
): SelfEmployedPlanCeilings {
  const net = Number.isFinite(netEarnings) ? Math.max(0, netEarnings) : 0;
  const elective = limits.elective_deferral_401k;
  const catchUp = electiveDeferralCatchUp(age, limits);
  const dollarLimit = limits.defined_contribution_415c;

  // SEP-IRA: the employer share alone, under both limbs. The compensation limb
  // is never the binding one here — 20% of net is always under half of it — but
  // it is applied rather than assumed away.
  const sepShare = net * EMPLOYER_SHARE_RATE;
  const sep = Math.min(sepShare, dollarLimit, net - sepShare);

  // Solo 401(k): the employer share worth making, given that each dollar of it
  // costs a dollar of the compensation the limit is measured against.
  const worthMaking = Math.max(0, (net - elective) / 2);
  const employerShare = Math.min(sepShare, worthMaking);
  const compensation = net - employerShare;
  const employeeDeferral = Math.min(elective, compensation);
  const additions = Math.min(employeeDeferral + employerShare, dollarLimit, compensation);
  // `additions` is a `min` that includes compensation, so it reaches compensation
  // exactly when limb (B) is the one that bound. Written `>=` rather than `===`
  // because these are floating-point dollars.
  const cappedByCompensation = additions >= compensation;

  return {
    sep,
    solo: additions + catchUp,
    employerShare,
    employeeDeferral,
    catchUp,
    cappedByCompensation,
  };
}
