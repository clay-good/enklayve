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
import type { SocialSecurityData } from "../data/schemas";

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
 * after FRA earns delayed-retirement credits, capped at the dataset's max age.
 */
export function socialSecurityBenefit(
  pia: number,
  bornYear: number,
  claimAgeYears: number,
  data: SocialSecurityData,
): SocialSecurityResult {
  const fraMonths = fullRetirementAgeMonths(bornYear, data);
  const claimAgeMonths = Math.round(claimAgeYears * 12);
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
    // Late: delayed-retirement credits, capped at the max claiming age.
    const cappedMonths = Math.min(claimAgeMonths, data.delayedCreditMaxAge * 12);
    const monthsLate = Math.max(0, cappedMonths - fraMonths);
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
