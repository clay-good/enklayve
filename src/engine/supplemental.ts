/**
 * Withholding on supplemental wages (SPEC-5 layoff-month J4): the optional flat
 * rate on the year's supplemental wages up to the threshold, and the mandatory
 * rate on the part over it (IRC §3402(g); Pub. 15 §7).
 */
import Decimal from "decimal.js";
import { Money } from "./money";
import type { SupplementalWithholdingData } from "../data/schemas";

export function supplementalWithholding(
  yearsSupplementalWages: number,
  rules: SupplementalWithholdingData,
): Money {
  const total = new Decimal(Math.max(0, yearsSupplementalWages));
  const under = Decimal.min(total, rules.mandatoryThreshold);
  const over = Decimal.max(0, total.minus(rules.mandatoryThreshold));
  return Money.from(
    under.times(rules.flatRate).plus(over.times(rules.mandatoryRate)),
  ).roundToCents();
}
