/**
 * Taxation of Social Security benefits (IRC §86, IRS Pub. 915 Worksheet 1).
 * "How much of my Social Security is taxable?" — a question most retirees get
 * wrong because the answer is neither 0% nor 100% but a sliding 0/50/85% set by
 * *provisional income*, against two statutory (never-indexed) base amounts.
 *
 * Provisional income = other income (AGI without Social Security) + tax-exempt
 * interest + half the benefits. Below `base1` none is taxable; between `base1`
 * and `base2` up to 50% of the benefit is taxable (the lesser of 50% of the
 * benefit or 50% of the provisional income over `base1`); above `base2` up to
 * 85% is taxable. The result is always capped at 85% of the benefit — Social
 * Security is never more than 85% taxable.
 *
 * Pure function of the inputs and the cited base amounts; clamps every input at
 * zero so an empty or negative field can never produce a non-finite figure.
 */
import { Money } from "./money";

export interface SsBenefitTaxInput {
  /** Annual Social Security benefits received. */
  socialSecurityBenefits: number;
  /** All other income — your AGI *excluding* Social Security. */
  otherIncome: number;
  /** Tax-exempt interest (e.g. municipal-bond interest), which still counts. */
  taxExemptInterest: number;
}

export interface SsBenefitTaxParams {
  /** First base amount: below it, no benefit is taxable. */
  base1: number;
  /** Second base amount: above it, the 85% tier applies. */
  base2: number;
  /** Max share taxable in the middle tier (0.50). */
  tier1InclusionRate: number;
  /** Max share ever taxable (0.85). */
  tier2InclusionRate: number;
}

/** Which taxation tier the filer falls in. */
export type SsTaxTier = "none" | "up-to-50" | "up-to-85";

export interface SsBenefitTaxResult {
  /** Other income + tax-exempt interest + half the benefits. */
  provisionalIncome: Money;
  /** The portion of the benefit pulled into taxable income. */
  taxableBenefits: Money;
  /** The portion that stays tax-free. */
  nonTaxableBenefits: Money;
  /** Taxable ÷ total benefits, in [0, 0.85]. */
  percentTaxable: number;
  tier: SsTaxTier;
}

export function socialSecurityBenefitTaxation(
  input: SsBenefitTaxInput,
  params: SsBenefitTaxParams,
): SsBenefitTaxResult {
  const benefits = Math.max(0, input.socialSecurityBenefits);
  const other = Math.max(0, input.otherIncome);
  const exempt = Math.max(0, input.taxExemptInterest);
  const { base1, base2, tier1InclusionRate: r1, tier2InclusionRate: r2 } = params;

  const provisional = other + exempt + r1 * benefits;

  let taxable: number;
  let tier: SsTaxTier;
  if (provisional <= base1) {
    taxable = 0;
    tier = "none";
  } else if (provisional <= base2) {
    // Middle tier: the lesser of 50% of the benefit or 50% of the amount over base1.
    taxable = Math.min(r1 * benefits, r1 * (provisional - base1));
    tier = "up-to-50";
  } else {
    // Top tier: 85% of the amount over base2, plus the middle-tier amount it
    // carries up (capped at 50% of the base1→base2 span), all capped at 85% of
    // the benefit — Social Security is never more than 85% taxable.
    const carriedFromMiddle = Math.min(r1 * benefits, r1 * (base2 - base1));
    taxable = Math.min(r2 * benefits, r2 * (provisional - base2) + carriedFromMiddle);
    tier = "up-to-85";
  }

  return {
    provisionalIncome: Money.from(provisional),
    taxableBenefits: Money.from(taxable),
    nonTaxableBenefits: Money.from(benefits - taxable),
    percentTaxable: benefits > 0 ? taxable / benefits : 0,
    tier,
  };
}
