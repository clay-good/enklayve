import { Money } from "./money";
import type { CpiData } from "../data/schemas";

/**
 * CPI inflation adjustment (BUILD-SPEC.md §3.4). Deterministic, straight from
 * the bundled BLS CPI-U annual averages — no prediction, no model. The value of
 * an amount from one year expressed in another year's dollars is:
 *
 *   adjusted = amount × (CPI[toYear] / CPI[fromYear])
 *
 * We never extrapolate: both years must be present in the dataset, or we return
 * null so the tile can ask the user to pick a year we actually have.
 */

export interface InflationResult {
  /** The amount expressed in `toYear` dollars. */
  adjusted: Money;
  /** The cumulative price change, e.g. 1.5 means prices rose 150%. */
  totalChange: number;
  /** The equivalent constant annual inflation rate over the span (0 if same year). */
  annualizedRate: number;
  fromYear: number;
  toYear: number;
}

/** The years available in the dataset, ascending. */
export function availableYears(data: CpiData): number[] {
  return Object.keys(data.byYear)
    .map(Number)
    .sort((a, b) => a - b);
}

export function adjustForInflation(
  amount: number,
  fromYear: number,
  toYear: number,
  data: CpiData,
): InflationResult | null {
  const from = data.byYear[String(fromYear)];
  const to = data.byYear[String(toYear)];
  if (from === undefined || to === undefined) return null;

  const ratio = to / from;
  const adjusted = Money.from(amount).multiply(ratio);
  const span = Math.abs(toYear - fromYear);
  const annualizedRate = span === 0 ? 0 : Math.pow(ratio, 1 / span) - 1;

  return {
    adjusted,
    totalChange: ratio - 1,
    annualizedRate,
    fromYear,
    toYear,
  };
}
