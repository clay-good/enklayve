import { Money } from "../money";
import type { FilingStatus, Jurisdiction } from "../../data/schemas";

/** A single marginal bracket (matches TaxBracketSchema). */
export interface Bracket {
  lowerBound: number;
  rate: number;
}

/**
 * Compute marginal-bracket tax on `taxable`. Brackets are sorted ascending
 * defensively; every dollar at or above a bracket's `lowerBound` (and below the
 * next bracket's) is taxed at that bracket's `rate`. This is the one generic
 * routine the whole engine uses for federal, state, and bracketed local tax —
 * adding a jurisdiction is data, not code (BUILD-SPEC.md §8).
 */
export function bracketTax(taxable: Money, brackets: readonly Bracket[]): Money {
  if (taxable.lessThanOrEqual(0) || brackets.length === 0) return Money.zero();
  const sorted = [...brackets].sort((a, b) => a.lowerBound - b.lowerBound);

  let tax = Money.zero();
  for (let i = 0; i < sorted.length; i++) {
    const lower = sorted[i]!.lowerBound;
    if (taxable.lessThanOrEqual(lower)) break;
    const nextLower = i + 1 < sorted.length ? sorted[i + 1]!.lowerBound : null;
    // The band runs from `lower` up to either the next bracket or the income.
    const ceiling = nextLower !== null && taxable.greaterThan(nextLower) ? nextLower : taxable;
    const bandAmount = (ceiling instanceof Money ? ceiling : Money.from(ceiling)).subtract(lower);
    tax = tax.add(bandAmount.multiply(sorted[i]!.rate));
  }
  return tax;
}

/** The statutory marginal rate of the band containing `taxable`. */
export function marginalBracketRate(taxable: Money, brackets: readonly Bracket[]): number {
  if (brackets.length === 0) return 0;
  const sorted = [...brackets].sort((a, b) => a.lowerBound - b.lowerBound);
  let rate = sorted[0]!.rate;
  for (const b of sorted) {
    if (taxable.greaterThanOrEqual(b.lowerBound)) rate = b.rate;
    else break;
  }
  return rate;
}

/**
 * The order in which to look up a filing status when a jurisdiction does not
 * define a separate schedule for it. The crucial case is **qualifying surviving
 * spouse**, which uses the married-filing-jointly schedule federally and in
 * essentially every state — so it must fall back to `married_jointly` *before*
 * `single`; falling straight to single (narrower brackets, smaller deduction)
 * overstates the tax. Married-filing-separately falls back to single, the
 * documented state-level assumption (many states tax MFS on the single
 * schedule). `single` is the universal last resort.
 */
function fallbackChain(status: FilingStatus): FilingStatus[] {
  if (status === "qualifying_surviving_spouse") {
    return [status, "married_jointly", "single"];
  }
  return status === "single" ? ["single"] : [status, "single"];
}

/**
 * Resolve the brackets for a filing status via {@link fallbackChain}. Throws
 * only if the jurisdiction defines no usable schedule at all.
 */
export function bracketsFor(jurisdiction: Jurisdiction, status: FilingStatus): Bracket[] {
  for (const candidate of fallbackChain(status)) {
    const brackets = jurisdiction.bracketsByFilingStatus[candidate];
    if (brackets) return brackets;
  }
  throw new Error(`${jurisdiction.id} defines no brackets for ${status} and no fallback`);
}

/** Standard deduction for a status (via {@link fallbackChain}), 0 if none. */
export function standardDeductionFor(jurisdiction: Jurisdiction, status: FilingStatus): number {
  const table = jurisdiction.standardDeductionByFilingStatus;
  for (const candidate of fallbackChain(status)) {
    const amount = table[candidate];
    if (amount !== undefined) return amount;
  }
  return 0;
}

/** Personal exemption for a status (via {@link fallbackChain}), 0 when none. */
export function personalExemptionFor(jurisdiction: Jurisdiction, status: FilingStatus): number {
  const table = jurisdiction.personalExemptionByFilingStatus;
  if (!table) return 0;
  for (const candidate of fallbackChain(status)) {
    const amount = table[candidate];
    if (amount !== undefined) return amount;
  }
  return 0;
}

/**
 * The taxpayer-tax-credit phase-out base for a status (via {@link fallbackChain}),
 * 0 when the jurisdiction has no such credit or no base for the status. Resolves
 * married-filing-separately → single and qualifying surviving spouse → married
 * jointly the same way the brackets do, so an unlisted status is never charged a
 * $0 base (which would phase the credit out from the first dollar).
 */
export function taxpayerCreditBaseFor(jurisdiction: Jurisdiction, status: FilingStatus): number {
  const table = jurisdiction.taxpayerCredit?.basePhaseOutByFilingStatus;
  if (!table) return 0;
  for (const candidate of fallbackChain(status)) {
    const amount = table[candidate];
    if (amount !== undefined) return amount;
  }
  return 0;
}

/**
 * The standard-deduction phase-out parameters for a status (via {@link
 * fallbackChain}), or undefined when the jurisdiction has none. Resolves
 * married-filing-separately → single and qualifying surviving spouse → married
 * jointly the same way the brackets do, so an unlisted status phases out on the
 * right schedule (South Carolina's SCIAD, S.C. Code §12-6-1140(15); Wisconsin's
 * sliding deduction, Wis. Stat. §71.05(23)(a)). Exactly one of `divisor` or
 * `reductionRate` is present on the returned entry (the schema enforces it).
 */
export function standardDeductionPhaseOutFor(
  jurisdiction: Jurisdiction,
  status: FilingStatus,
): { agiThreshold: number; divisor?: number; reductionRate?: number } | undefined {
  const table = jurisdiction.standardDeductionPhaseOut?.byFilingStatus;
  if (!table) return undefined;
  for (const candidate of fallbackChain(status)) {
    const params = table[candidate];
    if (params !== undefined) return params;
  }
  return undefined;
}

/** Resolve a per-status value through {@link fallbackChain}; `undefined` if none. */
function resolveByStatus<T>(
  table: Partial<Record<string, T>> | undefined,
  status: FilingStatus,
): T | undefined {
  if (!table) return undefined;
  for (const candidate of fallbackChain(status)) {
    const value = table[candidate];
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * The deductible federal income tax for a status — the Alabama / Oregon
 * "federal tax paid" subtraction taken against state taxable income
 * (FederalTaxDeductionSchema). Returns `min(federalIncomeTax, cap)`, where the
 * cap is:
 *
 *  - **+∞ (uncapped)** when the jurisdiction sets no `capByFilingStatus` — the
 *    full federal liability is deductible (Alabama, Ala. Code §40-18-15(a)(1)),
 *    so the result is just `federalIncomeTax`;
 *  - otherwise the filing-status cap (via {@link fallbackChain}, so an unlisted
 *    status is never charged a $0 cap), **linearly phased out by federal AGI**
 *    when a `phaseOut` is present (Oregon, ORS §316.695): the full cap at or
 *    below `agiThreshold`, zero at or above `agiZero`, pro-rated between.
 *
 * Zero when the jurisdiction has no federal-tax deduction at all. The federal
 * income tax is the engine's own computed figure (already floored at zero by
 * {@link bracketTax}), so the deduction can never be negative.
 */
export function federalTaxDeductionFor(
  jurisdiction: Jurisdiction,
  status: FilingStatus,
  federalIncomeTax: Money,
  agi: Money,
): Money {
  const ftd = jurisdiction.federalTaxDeduction;
  if (!ftd) return Money.zero();

  // Uncapped (Alabama): the whole federal liability is deductible.
  if (!ftd.capByFilingStatus) return federalIncomeTax;

  let cap = resolveByStatus(ftd.capByFilingStatus, status) ?? 0;

  // AGI phase-out of the cap (Oregon): linear from full (≤ threshold) to 0 (≥ zero).
  const po = resolveByStatus(ftd.phaseOut?.byFilingStatus, status);
  if (po) {
    const a = agi.toNumber();
    if (a >= po.agiZero) {
      cap = 0;
    } else if (a > po.agiThreshold) {
      cap = (cap * (po.agiZero - a)) / (po.agiZero - po.agiThreshold);
    }
  }

  const capMoney = Money.from(Math.max(0, cap));
  return federalIncomeTax.lessThan(capMoney) ? federalIncomeTax : capMoney;
}
