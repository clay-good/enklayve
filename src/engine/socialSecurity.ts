/**
 * Social Security claiming-age math (BUILD-SPEC-2 §6.7).
 *
 * Deterministic from the published SSA benefit-adjustment formula — no
 * prediction, no estimate of your earnings record. The user supplies their
 * Primary Insurance Amount (PIA), the monthly benefit they'd receive at Full
 * Retirement Age (it is printed on the SSA statement). The benefit at any other
 * claiming age is the PIA adjusted by the rule in the bundled, cited dataset:
 * reduced for claiming early, increased by delayed-retirement credits for
 * claiming after FRA, up to age 70.
 */
import Decimal from "decimal.js";
import { Money } from "./money";
import type { SocialSecurityData, SsEarningsTestData } from "../data/schemas";

export interface SocialSecurityResult {
  /** Full Retirement Age for the birth year, in months. */
  fraMonths: number;
  /** The claiming age in months. */
  claimAgeMonths: number;
  /** Months early (positive) or late (negative) relative to FRA. */
  monthsFromFra: number;
  /** Signed adjustment to the PIA (−0.30 = a 30% reduction, +0.24 = a 24% credit). */
  adjustment: number;
  /** Estimated monthly benefit at the claiming age. */
  monthlyBenefit: Money;
}

/** Full Retirement Age (in months) for a birth year, from the SSA table. */
export function fullRetirementAgeMonths(bornYear: number, data: SocialSecurityData): number {
  for (const entry of data.fullRetirementAge) {
    if (entry.bornThrough === null || bornYear <= entry.bornThrough) return entry.months;
  }
  // The table's final entry is open-ended, so this is unreachable; fall back to it.
  return data.fullRetirementAge[data.fullRetirementAge.length - 1]!.months;
}

/** A "fraction of one percent" (e.g. 5/9 of 1%) as an exact Decimal rate. */
function ofOnePercent(numer: number, denom: number): Decimal {
  return new Decimal(numer).div(denom).div(100);
}

/**
 * Estimated monthly benefit when claiming at `claimAgeYears` (whole years),
 * given the PIA and birth year. Early claiming reduces the benefit; claiming
 * after FRA earns delayed-retirement credits. The claiming age is clamped to
 * the dataset's window — you cannot claim before `earliestClaimAge`, and
 * credits stop at `delayedCreditMaxAge` — so every returned field describes an
 * age you could actually claim at.
 */
export function socialSecurityBenefit(
  pia: number,
  bornYear: number,
  claimAgeYears: number,
  data: SocialSecurityData,
): SocialSecurityResult {
  const fraMonths = fullRetirementAgeMonths(bornYear, data);
  // Claiming is only possible between the earliest age and the age at which
  // delayed credits stop accruing, so an age outside that window is reported
  // (and paid) as the nearest age inside it — not extrapolated past either end.
  const claimAgeMonths = Math.min(
    Math.max(Math.round(claimAgeYears * 12), data.earliestClaimAge * 12),
    data.delayedCreditMaxAge * 12,
  );
  const monthsFromFra = fraMonths - claimAgeMonths; // positive = early, negative = late
  const piaMoney = Money.from(Math.max(0, pia));

  let adjustment: Decimal;
  if (monthsFromFra > 0) {
    // Early: reduce by 5/9 of 1% per month for the first 36, then 5/12 of 1%.
    const first = Math.min(monthsFromFra, data.earlyReduction.firstMonths);
    const beyond = Math.max(0, monthsFromFra - data.earlyReduction.firstMonths);
    const reduction = ofOnePercent(
      data.earlyReduction.perMonthFirstNumer,
      data.earlyReduction.perMonthFirstDenom,
    )
      .times(first)
      .plus(
        ofOnePercent(
          data.earlyReduction.perMonthBeyondNumer,
          data.earlyReduction.perMonthBeyondDenom,
        ).times(beyond),
      );
    adjustment = reduction.negated();
  } else if (monthsFromFra < 0) {
    // Late: delayed-retirement credits. The age is already capped above.
    const monthsLate = claimAgeMonths - fraMonths;
    adjustment = ofOnePercent(
      data.delayedCreditPerMonthNumer,
      data.delayedCreditPerMonthDenom,
    ).times(monthsLate);
  } else {
    adjustment = new Decimal(0);
  }

  return {
    fraMonths,
    claimAgeMonths,
    monthsFromFra,
    adjustment: adjustment.toNumber(),
    monthlyBenefit: piaMoney.multiply(adjustment.plus(1)),
  };
}

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
