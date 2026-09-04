/**
 * The tax engine (BUILD-SPEC.md §3, §8): one generic evaluator that composes
 * typed jurisdiction data files into a fully cited result. Adding a jurisdiction
 * is data, not code.
 */
export { evaluateTaxes, MARGINAL_PROBE, type TaxContext } from "./evaluate";
export {
  bracketTax,
  marginalBracketRate,
  bracketsFor,
  standardDeductionFor,
  agedStandardDeductionFor,
  personalExemptionFor,
  type Bracket,
} from "./brackets";
export { computeFica, selfEmploymentTax, type SelfEmploymentTaxResult } from "./fica";
export {
  chooseFederalDeduction,
  itemizedTotal,
  saltCapFor,
  seniorDeductionFor,
  steppedIncomeDeductionFor,
  nonItemizerCharitableFor,
  MEDICAL_AGI_FLOOR_RATE,
} from "./deductions";
export type {
  DeductionMode,
  DeductionResult,
  FicaResult,
  ItemizedInput,
  JurisdictionTaxResult,
  LocalTaxLine,
  LocalTaxResult,
  TaxInput,
  TaxResult,
  TaxTotals,
} from "./types";
