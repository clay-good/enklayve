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
 * Resolve the brackets for a filing status, falling back to "single" when a
 * jurisdiction does not define a separate schedule for that status (e.g. many
 * states use the single schedule for married-filing-separately). Throws only if
 * the jurisdiction defines no brackets at all.
 */
export function bracketsFor(jurisdiction: Jurisdiction, status: FilingStatus): Bracket[] {
  const direct = jurisdiction.bracketsByFilingStatus[status];
  if (direct) return direct;
  const single = jurisdiction.bracketsByFilingStatus.single;
  if (single) return single;
  throw new Error(`${jurisdiction.id} defines no brackets for ${status} and no single fallback`);
}

/** Standard deduction for a status, falling back to "single" then 0. */
export function standardDeductionFor(jurisdiction: Jurisdiction, status: FilingStatus): number {
  return (
    jurisdiction.standardDeductionByFilingStatus[status] ??
    jurisdiction.standardDeductionByFilingStatus.single ??
    0
  );
}

/** Personal exemption for a status (0 when the jurisdiction defines none). */
export function personalExemptionFor(jurisdiction: Jurisdiction, status: FilingStatus): number {
  const table = jurisdiction.personalExemptionByFilingStatus;
  if (!table) return 0;
  return table[status] ?? table.single ?? 0;
}
