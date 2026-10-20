/**
 * Social Security rules only the on-demand later-life tools read (SPEC-5
 * Phase 29): the retirement earnings test, and spousal and survivor
 * reductions. Kept out of `socialSecurity.ts`, which the claiming tool loads
 * with the shell, so these load with the tools that use them (SPEC-5 §7.5).
 */
import Decimal from "decimal.js";
import { Money } from "./money";
import type { SsEarningsTestData, SsFamilyBenefitsData } from "../data/schemas";

export interface EarningsTestInput {
  monthlyBenefit: number;
  /** "before": full retirement age is in a later year; "this-year": it is reached this year. */
  stage: "before" | "this-year";
  /** Earnings that count: the year's, or in the year of FRA, those in the months before it. */
  earnings: number;
  /** Months of benefits that can be withheld: 12, or the months before the FRA month. */
  months: number;
}

export interface EarningsTestResult {
  exempt: number;
  /** The amount the test withholds. */
  withheld: Money;
  /** Whole monthly benefits held back to cover it. */
  monthsWithheld: number;
  /** Benefits still paid this year, in the months not withheld. */
  paid: Money;
}

/**
 * The retirement earnings test (42 U.S.C. §403(b), (f)): $1 withheld for every
 * $2 over the lower exempt amount, or $1 for every $3 over the higher one in the
 * year full retirement age is reached. Social Security holds back whole monthly
 * benefits until the amount is covered, and credits those months back at full
 * retirement age (§402(q)(7)).
 */
export function earningsTest(
  input: EarningsTestInput,
  rules: SsEarningsTestData,
): EarningsTestResult {
  const fraYear = input.stage === "this-year";
  const exempt = fraYear ? rules.higherAnnualExempt : rules.lowerAnnualExempt;
  const per = fraYear ? rules.earningsPerDollarWithheldInFraYear : rules.earningsPerDollarWithheld;
  const months = Math.max(0, Math.min(12, Math.floor(input.months)));
  const benefit = new Decimal(Math.max(0, input.monthlyBenefit));
  const due = Decimal.max(0, new Decimal(Math.max(0, input.earnings)).minus(exempt)).dividedBy(per);
  const monthsWithheld = benefit.isZero()
    ? 0
    : Math.min(months, due.dividedBy(benefit).ceil().toNumber());
  return {
    exempt,
    withheld: Money.from(due).roundToCents(),
    monthsWithheld,
    paid: Money.from(benefit.times(months - monthsWithheld)).roundToCents(),
  };
}

/** A reduction rounded up to the next multiple of `step`, as §404.410 rounds it. */
function roundUpTo(value: Decimal, step: number): Decimal {
  return value.dividedBy(step).ceil().times(step);
}

/** A survivor's full retirement age in months, from §404.409(b). */
export function survivorFraMonths(birthYear: number, rules: SsFamilyBenefitsData): number {
  const row = rules.survivorFullRetirementAge.find(
    (r) => r.bornThrough === null || birthYear <= r.bornThrough,
  );
  return row?.months ?? rules.survivorFullRetirementAge.at(-1)!.months;
}

/**
 * A spouse's benefit on the worker's record (§404.410(b)): half the worker's
 * PIA, reduced 25/36 of 1% a month for the first 36 months before the spouse's
 * full retirement age and 5/12 of 1% beyond, the reduction rounded up to a dime.
 */
export function spousalBenefit(
  workerPia: number,
  spouseFraMonths: number,
  claimAgeMonths: number,
  rules: SsFamilyBenefitsData,
): { unreduced: Money; reduction: Money; monthly: Money; monthsEarly: number } {
  const unreduced = new Decimal(Math.max(0, workerPia)).times(rules.spousalShare);
  const claim = Math.max(rules.earliestSpousalAge * 12, claimAgeMonths);
  const early = Math.max(0, spouseFraMonths - claim);
  const pct = new Decimal(Math.min(early, 36))
    .times(rules.spousalReductionFirst36Numer)
    .dividedBy(rules.spousalReductionFirst36Denom)
    .plus(
      new Decimal(Math.max(0, early - 36))
        .times(rules.spousalReductionBeyondNumer)
        .dividedBy(rules.spousalReductionBeyondDenom),
    )
    .dividedBy(100);
  const reduction =
    early > 0 ? roundUpTo(unreduced.times(pct), rules.reductionRoundedUpTo) : new Decimal(0);
  return {
    unreduced: Money.from(unreduced).roundToCents(),
    reduction: Money.from(reduction).roundToCents(),
    monthly: Money.from(Decimal.max(0, unreduced.minus(reduction))).roundToCents(),
    monthsEarly: early,
  };
}

/**
 * A survivor's benefit (§404.410(c)(1)): the deceased worker's PIA, reduced by
 * the months before the survivor's full retirement age times .285, over the
 * months from 60 to that age, the reduction rounded up to a dime.
 */
export function survivorBenefit(
  deceasedPia: number,
  survivorFraMonthsValue: number,
  claimAgeMonths: number,
  rules: SsFamilyBenefitsData,
): { reduction: Money; monthly: Money; monthsEarly: number } {
  const base = new Decimal(Math.max(0, deceasedPia));
  const from = rules.earliestSurvivorAge * 12;
  const claim = Math.max(from, claimAgeMonths);
  const early = Math.max(0, survivorFraMonthsValue - claim);
  const span = survivorFraMonthsValue - from;
  const reduction =
    early > 0 && span > 0
      ? roundUpTo(
          base.times(early).times(rules.survivorMaxReduction).dividedBy(span),
          rules.reductionRoundedUpTo,
        )
      : new Decimal(0);
  return {
    reduction: Money.from(reduction).roundToCents(),
    monthly: Money.from(Decimal.max(0, base.minus(reduction))).roundToCents(),
    monthsEarly: early,
  };
}
