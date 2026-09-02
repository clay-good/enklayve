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
  /**
   * How many people on the return had turned 65 by the close of the year: the
   * taxpayer, and on a joint return the spouse. Drives IRC §151(d)(5)(C).
   * Absent means none, which is the answer for most returns and the one that
   * changes nothing for a caller written before the deduction existed.
   */
  seniorsAge65Plus?: number;
  /** Qualified tips within `wages`, for IRC §224. */
  qualifiedTips?: number;
  /** Qualified overtime premium within `wages`, for IRC §225. */
  qualifiedOvertime?: number;
  /**
   * Interest paid on a car loan that meets IRC §163(h)(4): a first lien taken
   * out after 2024 on a new, personally used vehicle assembled in the United
   * States. Unlike tips and overtime this is not part of `wages` — it is money
   * paid out, not earned — so it is its own input rather than a share of one.
   */
  vehicleLoanInterest?: number;
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
  /**
   * The standard or itemized deduction alone. Deliberately NOT the total
   * subtracted from AGI: §170(p) rides alongside it under §63(b)(4) and is
   * reported separately, so that everything already reading this field — the
   * result labels, and Utah's taxpayer credit, which is a percentage of *the
   * federal deduction* under Utah Code §59-10-1018 — keeps meaning what it
   * meant. Whether Utah conforms to §170(p) is a question for Utah, and
   * silently answering it by widening this number is not the way to ask.
   */
  amount: Money;
  /**
   * IRC §170(p): cash giving a non-itemizer deducts on top of the standard
   * deduction. Zero when the filer itemizes, when they gave nothing, or for a
   * tax year whose shard carries no such rule.
   */
  nonItemizedCharitable: Money;
  /**
   * IRC §151(d)(5)(C): the deduction at 65. Unlike §170(p) it does not depend
   * on taking the standard deduction, so it can be non-zero either way.
   */
  senior: Money;
  /** IRC §224, the deduction for qualified tips. Also independent of the choice. */
  qualifiedTips: Money;
  /** IRC §225, the deduction for qualified overtime. */
  qualifiedOvertime: Money;
  /**
   * IRC §68: how much of the itemized deduction was taken back by the 35% value
   * cap. Zero for a filer taking the standard deduction, and for any itemizer
   * whose income does not reach the 37% bracket — which is almost all of them.
   *
   * Reported rather than folded away silently because `amount` above is the
   * figure AFTER the reduction, and a reader who entered $60,000 of mortgage
   * interest and is shown a $56,756.76 deduction is owed the sentence in
   * between. Showing the work is the whole promise.
   */
  itemizedLimitation: Money;
  /**
   * IRC §163(h)(4), qualified passenger vehicle loan interest. Reached by
   * §63(b)(7) for a filer who does not itemize and by §163(a) for one who does,
   * so like §151 and unlike §170(p) it does not depend on the choice.
   */
  vehicleLoanInterest: Money;
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
