/**
 * COBRA against the Marketplace (SPEC-5 Phase 28, layoff-month J2).
 *
 * The COBRA premium is the one on the election notice. The Marketplace side is
 * the benchmark premium less the premium tax credit at the household's
 * projected income for the year, from `estimatePremiumTaxCredit`, which after a
 * layoff is usually lower than the W-2 that was. And the notice's premium is
 * checked against the law's ceiling, a share of the plan's full cost, when the
 * reader has that figure.
 */
import Decimal from "decimal.js";
import { Money } from "./money";
import { estimatePremiumTaxCredit, type AcaResult } from "./benefits";
import type { AcaData, FederalPovertyLevelData, SeparationRulesData } from "../data/schemas";

export interface CobraInput {
  cobraMonthly: number;
  /** The plan's full monthly cost, if the notice states it; 0 when unknown. */
  planFullCostMonthly: number;
  /** In the disability extension, after the 18th month. */
  disabilityExtension: boolean;
  householdSize: number;
  /** Household income projected for the whole year, the figure §36B uses. */
  projectedAnnualIncome: number;
  benchmarkMonthly: number;
}

export interface CobraResult {
  cobraMonthly: Money;
  credit: AcaResult;
  /** The benchmark plan after the credit. */
  marketplaceMonthly: Money;
  /** Positive when the Marketplace costs less. */
  monthlySavingOnMarketplace: Money;
  annualSavingOnMarketplace: Money;
  /** The most the plan may charge, when its full cost is known. */
  ceilingMonthly: Money | null;
  overCeiling: boolean;
}

export function cobraVsMarketplace(
  input: CobraInput,
  rules: SeparationRulesData,
  aca: AcaData,
  fpl: FederalPovertyLevelData,
): CobraResult {
  const credit = estimatePremiumTaxCredit(
    {
      householdSize: Math.max(1, Math.round(input.householdSize)),
      annualIncome: Math.max(0, input.projectedAnnualIncome),
      benchmarkMonthlyPremium: Math.max(0, input.benchmarkMonthly),
    },
    aca,
    fpl,
  );
  const cobra = Money.from(Math.max(0, input.cobraMonthly));
  const benchmark = Money.from(Math.max(0, input.benchmarkMonthly));
  const afterCredit = benchmark.subtract(credit.monthlyCredit);
  const marketplace = afterCredit.isNegative() ? Money.zero() : afterCredit;
  const saving = cobra.subtract(marketplace);
  const share = input.disabilityExtension
    ? rules.cobraDisabilityExtensionCeiling
    : rules.cobraPremiumCeiling;
  const full = Math.max(0, input.planFullCostMonthly);
  const ceiling = full > 0 ? Money.from(new Decimal(full).times(share)).roundToCents() : null;
  return {
    cobraMonthly: cobra,
    credit,
    marketplaceMonthly: marketplace.roundToCents(),
    monthlySavingOnMarketplace: saving.roundToCents(),
    annualSavingOnMarketplace: saving.multiply(12).roundToCents(),
    ceilingMonthly: ceiling,
    overCeiling: ceiling !== null && cobra.greaterThan(ceiling),
  };
}
