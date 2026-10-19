/**
 * Cashing out a retirement plan before 59½ (SPEC-5 Phase 28, layoff-month J1).
 *
 * Four figures. What arrives: the balance less §3405(c)'s mandatory 20%
 * withholding. What is owed: the distribution as ordinary income, stacked on the
 * year's other income through the federal and state engines — so the real
 * marginal cost rather than the 20% the withholding implies — plus §72(t)'s 10%
 * on whatever no exception covers. The exceptions are ones the reader ticks,
 * never inferred. And the balance due at filing: the federal tax and the
 * additional tax, less what was withheld.
 */
import Decimal from "decimal.js";
import { Money } from "./money";
import { evaluateTaxes, type TaxContext } from "./tax";
import type { TaxInput } from "./tax/types";
import type { EarlyDistributionData } from "../data/schemas";

export interface EarlyDistributionInput {
  amount: number;
  /** Age at the distribution, which may be fractional (59.5). */
  age: number;
  /** Left this employer in or after the year of turning 55 (§72(t)(2)(A)(v)). */
  separatedAtSeparationAge: boolean;
  /** A qualified public-safety employee who left in or after the year of turning 50. */
  publicSafetySeparation: boolean;
  /** An exception that covers the whole distribution: disability, a series of
   * substantially equal payments, terminal illness, an alternate payee. */
  wholeException: boolean;
  /** The once-a-year emergency personal expense distribution (§72(t)(2)(I)). */
  emergency: boolean;
  /** Dollars another exception covers: medical, domestic abuse, birth or adoption. */
  otherExcepted: number;
  /** The income tax the distribution adds, from {@link incomeTaxOnDistribution}. */
  federalTax: Money;
  stateTax: Money;
}

export interface EarlyDistributionResult {
  withheld: Money;
  /** What the plan pays out: the amount less the mandatory withholding. */
  check: Money;
  /** The part §72(t)'s 10% does not reach. */
  excepted: Money;
  additionalTax: Money;
  federalTax: Money;
  stateTax: Money;
  /** Every tax the distribution costs. */
  totalCost: Money;
  /** Federal tax and additional tax, less the withholding; negative is a refund. */
  federalDueAtFiling: Money;
  /** The amount less every tax it costs. */
  kept: Money;
  /** Why no additional tax applies, when none does. */
  noAdditionalTaxBecause: "age" | "separation" | "exception" | null;
}

export function earlyDistributionCost(
  input: EarlyDistributionInput,
  rules: EarlyDistributionData,
): EarlyDistributionResult {
  const amount = new Decimal(Math.max(0, input.amount));
  let because: EarlyDistributionResult["noAdditionalTaxBecause"] = null;
  let excepted: Decimal;
  if (input.age >= rules.penaltyFreeAge) {
    excepted = amount;
    because = "age";
  } else if (input.separatedAtSeparationAge || input.publicSafetySeparation) {
    excepted = amount;
    because = "separation";
  } else if (input.wholeException) {
    excepted = amount;
    because = "exception";
  } else {
    excepted = Decimal.min(
      amount,
      new Decimal(input.emergency ? rules.emergencyExpenseLimit : 0).plus(
        Math.max(0, input.otherExcepted),
      ),
    );
    if (excepted.equals(amount) && amount.greaterThan(0)) because = "exception";
  }
  const additional = amount.minus(excepted).times(rules.additionalTaxRate);
  const withheld = amount.times(rules.mandatoryWithholdingRate);
  const federal = new Decimal(input.federalTax.toNumber());
  const state = new Decimal(input.stateTax.toNumber());
  const total = federal.plus(state).plus(additional);
  return {
    withheld: Money.from(withheld).roundToCents(),
    check: Money.from(amount.minus(withheld)).roundToCents(),
    excepted: Money.from(excepted).roundToCents(),
    additionalTax: Money.from(additional).roundToCents(),
    federalTax: Money.from(federal).roundToCents(),
    stateTax: Money.from(state).roundToCents(),
    totalCost: Money.from(total).roundToCents(),
    federalDueAtFiling: Money.from(federal.plus(additional).minus(withheld)).roundToCents(),
    kept: Money.from(amount.minus(total)).roundToCents(),
    noAdditionalTaxBecause: because,
  };
}

/**
 * The income tax a distribution adds, federal and state: the year's return
 * with it as ordinary income, less the same return without it. Computed by the
 * same engine as every other tax figure on the site, so it carries the
 * jurisdiction's own deductions, brackets and credits.
 */
export function incomeTaxOnDistribution(
  amount: number,
  base: TaxInput,
  ctx: TaxContext,
): { federal: Money; state: Money } {
  const without = evaluateTaxes(base, ctx);
  const withIt = evaluateTaxes(
    { ...base, otherIncome: (base.otherIncome ?? 0) + Math.max(0, amount) },
    ctx,
  );
  const stateOf = (r: typeof without): Money => r.state?.incomeTax ?? Money.zero();
  return {
    federal: withIt.federal.incomeTax.subtract(without.federal.incomeTax),
    state: stateOf(withIt).subtract(stateOf(without)),
  };
}
