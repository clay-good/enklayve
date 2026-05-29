import { Money } from "./money";
import type { RmdData } from "../data/schemas";

/**
 * Required Minimum Distribution (BUILD-SPEC.md §3.4). Deterministic, straight
 * from the IRS Uniform Lifetime Table (Pub 590-B):
 *
 *   RMD = prior-year-end balance ÷ distribution period for your age
 *
 * The Uniform Lifetime Table covers a single owner whose sole beneficiary is not
 * a spouse more than ten years younger (the common case). RMDs begin at the age
 * in the dataset's `beginAge` (73 for 2024 under SECURE 2.0). Ages at or beyond
 * the table's top use the terminal factor.
 */

export interface RmdResult {
  /** The required minimum distribution for the year, rounded to cents. */
  amount: Money;
  /** The Uniform Lifetime Table distribution period used. */
  distributionPeriod: number;
  /** True when the owner is at or past the age RMDs begin. */
  required: boolean;
  /** The age RMDs begin (from the dataset). */
  beginAge: number;
}

/** Highest age present in the table — ages beyond it reuse this factor. */
function topAge(data: RmdData): number {
  return Object.keys(data.distributionPeriodByAge)
    .map(Number)
    .reduce((max, n) => (n > max ? n : max), 0);
}

export function requiredMinimumDistribution(
  age: number,
  priorYearEndBalance: number,
  data: RmdData,
): RmdResult {
  const required = age >= data.beginAge;
  const max = topAge(data);
  const lookup = Math.min(Math.max(age, data.beginAge), max);
  const period = data.distributionPeriodByAge[String(lookup)];

  if (!required || period === undefined) {
    return {
      amount: Money.zero(),
      distributionPeriod: period ?? 0,
      required,
      beginAge: data.beginAge,
    };
  }

  const balance = Money.from(Math.max(0, priorYearEndBalance));
  return {
    amount: balance.divide(period),
    distributionPeriod: period,
    required: true,
    beginAge: data.beginAge,
  };
}
