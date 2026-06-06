import { Money } from "../money";
import type { DeductionMode, DeductionResult, ItemizedInput } from "./types";

/** Federal SALT cap (BUILD-SPEC.md §3.2 "state and local taxes capped"). */
export const SALT_CAP = 10000;
/** Medical expenses are deductible only above 7.5% of AGI. */
export const MEDICAL_AGI_FLOOR_RATE = 0.075;

/**
 * Total federal itemized deduction from the "big four" (BUILD-SPEC.md §3.2):
 * SALT (capped), mortgage interest, charitable contributions, and medical
 * expenses above the AGI floor. AGI-based charitable limits and other refinements
 * are out of scope for this phase.
 */
export function itemizedTotal(itemized: ItemizedInput, agi: Money): Money {
  const salt = Money.from(Math.min(itemized.stateAndLocalTaxes ?? 0, SALT_CAP));
  const mortgage = Money.from(itemized.mortgageInterest ?? 0);
  const charitable = Money.from(itemized.charitable ?? 0);

  // 7.5% of AGI, but never negative: a non-positive AGI yields a $0 floor, so
  // the whole expense is deductible and the deduction never exceeds the actual
  // expense. (Through evaluateTaxes the AGI is already clamped at zero; this
  // keeps itemizedTotal correct if called directly with a negative AGI — the
  // large-adjustments corner in SPEC-3-hardening §D.)
  const medicalFloor = agi.isNegative() ? Money.zero() : agi.multiply(MEDICAL_AGI_FLOOR_RATE);
  const medicalRaw = Money.from(itemized.medicalExpenses ?? 0);
  const medical = medicalRaw.greaterThan(medicalFloor)
    ? medicalRaw.subtract(medicalFloor)
    : Money.zero();

  return salt.add(mortgage).add(charitable).add(medical);
}

/**
 * Choose the federal deduction. "auto" (the default) takes the larger of the
 * standard deduction and the itemized total — the choice a rational filer makes.
 */
export function chooseFederalDeduction(
  mode: DeductionMode,
  standardDeduction: Money,
  itemized: ItemizedInput,
  agi: Money,
): DeductionResult {
  const itemizedAmount = itemizedTotal(itemized, agi);
  if (mode === "standard") return { kind: "standard", amount: standardDeduction };
  if (mode === "itemized") return { kind: "itemized", amount: itemizedAmount };
  return itemizedAmount.greaterThan(standardDeduction)
    ? { kind: "itemized", amount: itemizedAmount }
    : { kind: "standard", amount: standardDeduction };
}
