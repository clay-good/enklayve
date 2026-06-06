/**
 * Gift-tax exclusion tracker (SPEC-3 §4.4, IRC §2503(b), §2010, §2001(c)). "Is my
 * gift to family taxable, or does it sit under the annual exclusion / lifetime
 * exemption?" Descriptive, not advisory — it never says whether to make the gift.
 *
 * Pure function of the inputs and the cited gift-tax shard. A present-interest
 * gift up to the annual exclusion (per recipient, per year) is excluded outright;
 * gifts to a citizen spouse are fully covered by the unlimited marital deduction;
 * a non-citizen spouse has a higher annual exclusion. Anything over the exclusion
 * draws down the lifetime exemption (no tax until it is exhausted), and a gift
 * over the annual exclusion requires a Form 709 even when no tax is due.
 */
import { Money } from "./money";
import type { GiftTaxData } from "../data/schemas";

export interface GiftTaxInput {
  /** The gift amount to a single recipient this year. */
  giftAmount: number;
  /** Whether the recipient is your spouse. */
  recipientIsSpouse: boolean;
  /** Whether that spouse is a US citizen (only consulted when a spouse). */
  spouseIsUSCitizen: boolean;
  /** Lifetime exemption already used by prior taxable gifts (user-supplied). */
  lifetimeExemptionUsed: number;
}

export interface GiftTaxResult {
  /** The annual exclusion that applied (non-citizen-spouse amount when relevant). */
  annualExclusion: Money;
  /** The portion of the gift covered by the annual exclusion. */
  exclusionApplied: Money;
  /** The portion over the annual exclusion (draws down the lifetime exemption). */
  taxableGift: Money;
  /** Lifetime exemption remaining after this gift. */
  lifetimeExemptionRemaining: Money;
  /** Whether a Form 709 gift-tax return is required. */
  form709Required: boolean;
  /** Estimated gift tax due (top rate on amounts beyond the lifetime exemption). */
  estimatedTaxDue: Money;
  /** True when the unlimited marital deduction fully covers the gift. */
  maritalDeduction: boolean;
}

export function giftTaxImpact(input: GiftTaxInput, data: GiftTaxData): GiftTaxResult {
  const gift = Math.max(0, input.giftAmount);
  const usedBefore = Math.max(0, input.lifetimeExemptionUsed);

  // A gift to a US-citizen spouse is fully deductible (unlimited marital deduction):
  // nothing is taxable, no return is required for a present-interest gift.
  if (input.recipientIsSpouse && input.spouseIsUSCitizen) {
    return {
      annualExclusion: Money.from(data.annualExclusion),
      exclusionApplied: Money.from(gift),
      taxableGift: Money.zero(),
      lifetimeExemptionRemaining: Money.from(data.lifetimeExemption - usedBefore),
      form709Required: false,
      estimatedTaxDue: Money.zero(),
      maritalDeduction: true,
    };
  }

  const exclusionNum =
    input.recipientIsSpouse && !input.spouseIsUSCitizen
      ? data.annualExclusionNonCitizenSpouse
      : data.annualExclusion;
  const exclusionApplied = Math.min(gift, exclusionNum);
  const taxableGift = Math.max(0, gift - exclusionNum);

  const usedAfter = usedBefore + taxableGift;
  const remaining = data.lifetimeExemption - usedAfter;
  const overExemption = Math.max(0, usedAfter - data.lifetimeExemption);

  return {
    annualExclusion: Money.from(exclusionNum),
    exclusionApplied: Money.from(exclusionApplied),
    taxableGift: Money.from(taxableGift),
    lifetimeExemptionRemaining: Money.from(remaining),
    form709Required: taxableGift > 0,
    estimatedTaxDue: Money.from(overExemption).multiply(data.topRate),
    maritalDeduction: false,
  };
}
