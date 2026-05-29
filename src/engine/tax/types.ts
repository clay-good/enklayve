import type { Money } from "../money";
import type { CitationData, FilingStatus } from "../../data/schemas";

/**
 * Public types for the tax engine (BUILD-SPEC.md §3, §8). Federal, state, and
 * local computations compose into one {@link TaxResult} where every monetary
 * line carries the citation of the jurisdiction (or FICA dataset) that produced
 * it — no orphan numbers (§9).
 */

/** How to choose the federal deduction. */
export type DeductionMode = "standard" | "itemized" | "auto";

/** The "big four" itemized inputs (BUILD-SPEC.md §3.2). */
export interface ItemizedInput {
  /** State and local taxes paid; capped at the federal SALT limit. */
  stateAndLocalTaxes?: number;
  mortgageInterest?: number;
  charitable?: number;
  /** Total medical expenses; only the amount above the AGI floor counts. */
  medicalExpenses?: number;
}

export interface TaxInput {
  filingStatus: FilingStatus;
  /** W-2 wages: subject to both income tax and FICA. */
  wages: number;
  /** Additional ordinary income (interest, etc.): income tax only, no FICA. */
  otherIncome?: number;
  /** Above-the-line adjustments that reduce AGI (e.g. deductible HSA). */
  adjustments?: number;
  /** Federal deduction choice. Defaults to "auto" (the larger of the two). */
  deductionMode?: DeductionMode;
  itemized?: ItemizedInput;
  /** Local add-ons (by id) that apply, e.g. ["nyc"]. Defaults to none. */
  localJurisdictionIds?: string[];
}

export interface DeductionResult {
  kind: "standard" | "itemized";
  amount: Money;
}

export interface JurisdictionTaxResult {
  jurisdictionId: string;
  jurisdictionName: string;
  taxableIncome: Money;
  deduction: DeductionResult;
  incomeTax: Money;
  citation: CitationData;
}

export interface FicaResult {
  socialSecurity: Money;
  medicare: Money;
  additionalMedicare: Money;
  total: Money;
  citation: CitationData;
}

export interface LocalTaxLine {
  id: string;
  name: string;
  tax: Money;
}

export interface LocalTaxResult {
  lines: LocalTaxLine[];
  total: Money;
  /** Citation of the state jurisdiction the add-ons came from (null if none). */
  citation: CitationData | null;
}

export interface TaxTotals {
  totalTax: Money;
  takeHome: Money;
  /** Combined marginal rate on the next dollar of wages (federal+FICA+state+local). */
  marginalRate: number;
  /** Total tax divided by gross income. */
  effectiveRate: number;
}

export interface TaxResult {
  filingStatus: FilingStatus;
  grossIncome: Money;
  agi: Money;
  federal: JurisdictionTaxResult;
  fica: FicaResult;
  /** Null when no state jurisdiction was supplied. */
  state: JurisdictionTaxResult | null;
  local: LocalTaxResult;
  totals: TaxTotals;
}
