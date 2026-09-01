/**
 * IRC §530A accounts: what a child's account holds at 18, and what is taxable.
 *
 * The One Big Beautiful Bill Act's savings account for a child under 18. It is
 * modeled here rather than folded into the general compound-growth tile because
 * three of its rules are the account rather than decoration, and each one
 * changes the answer:
 *
 *   §530A(c)(2)(A)  contributions are capped at $5,000 a calendar year, so a
 *                   projection that quietly accepts more is projecting an
 *                   account nobody may open.
 *   §6434           the $1,000 is paid by the Secretary for a child born after
 *                   2024 and before 2029 — a window, not a benefit, and it ends.
 *   §530A(b)(1)(C)  nothing goes in before July 4, 2026 and nothing comes out
 *                   before the calendar year the beneficiary turns 18.
 *
 * And the fourth, which is not a figure at all: §530A(a) treats the account "in
 * the same manner as an individual retirement account under section 408(a)", so
 * this is a tax-DEFERRED account and not a tax-free one. §530A(d)(2) then keeps
 * the §6434 payment, qualified general contributions and §128 employer money out
 * of the investment in the contract — they carry no basis, so they are taxed in
 * full on the way out along with every dollar of growth. The result reports the
 * taxable share separately for exactly that reason: the headline balance is the
 * number a family will remember, and some of it belongs to a future tax bill.
 */
import { Money } from "./money";
import { compoundGrowth } from "./finance";
import type { TrumpAccountData } from "../data/schemas";

export interface TrumpAccountInput {
  /** The beneficiary's age today, in whole years. */
  currentAge: number;
  /** The calendar year the beneficiary was born, for the §6434 window. */
  birthYear: number;
  /** What the family expects to put in each year, before the statutory cap. */
  annualContribution: number;
  /** Anything already in the account. */
  currentBalance: number;
  /** Expected annual return, as a fraction (0.07 for 7%). */
  annualReturnRate: number;
}

export interface TrumpAccountResult {
  /** Years until the beneficiary reaches the distribution age. */
  yearsToDistribution: number;
  /** The contribution actually modeled: the input, capped by §530A(c)(2)(A). */
  contributionApplied: Money;
  /** True when the input was above the cap and was reduced to it. */
  contributionWasCapped: boolean;
  /** $1,000 under §6434, or zero when the birth year is outside the window. */
  pilotContribution: Money;
  /** Whether the §6434 birth-year window covers this beneficiary. */
  pilotEligible: boolean;
  /** Projected balance in the year the beneficiary reaches the distribution age. */
  balanceAtDistribution: Money;
  /** Every dollar put in, including the §6434 payment. */
  totalContributed: Money;
  /**
   * What is taxable as ordinary income when withdrawn: everything except the
   * family's own after-tax contributions, which are the only basis §530A(d)(2)
   * leaves in the account.
   */
  taxableAtDistribution: Money;
}

/**
 * Project one §530A account to the distribution age.
 *
 * Deliberately a projection and not a promise: the return is the reader's
 * assumption, and eligible investments are restricted to funds tracking a
 * qualified index (Treasury/IRS guidance, August 2026), so the assumption
 * belongs to a market rather than to this engine.
 */
export function projectTrumpAccount(
  input: TrumpAccountInput,
  data: TrumpAccountData,
): TrumpAccountResult {
  const age = Math.max(0, Math.floor(input.currentAge));
  const years = Math.max(0, data.distributionAge - age);
  const wanted = Math.max(0, input.annualContribution);
  const applied = Math.min(wanted, data.annualContributionLimit);

  const pilotEligible =
    input.birthYear >= data.pilotBirthYearFirst && input.birthYear <= data.pilotBirthYearLast;
  const pilot = pilotEligible ? data.pilotContribution : 0;

  // The §6434 payment is seed money: it is in the account from the start rather
  // than arriving as one of the years of contributions.
  const opening = Math.max(0, input.currentBalance) + pilot;
  const growth = compoundGrowth({
    principal: opening,
    contribution: applied,
    annualRate: input.annualReturnRate,
    years,
    periodsPerYear: 1,
    contributeAtStart: false,
  });

  const familyContributed = Money.from(Math.max(0, input.currentBalance)).add(applied * years);
  const totalContributed = familyContributed.add(pilot);
  // Basis is the family's own money only. The seed and all growth are taxable.
  const taxable = growth.futureValue.subtract(familyContributed);

  return {
    yearsToDistribution: years,
    contributionApplied: Money.from(applied),
    contributionWasCapped: wanted > data.annualContributionLimit,
    pilotContribution: Money.from(pilot),
    pilotEligible,
    balanceAtDistribution: growth.futureValue,
    totalContributed,
    taxableAtDistribution: taxable.isNegative() ? Money.zero() : taxable,
  };
}
