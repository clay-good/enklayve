import Decimal from "decimal.js";
import { Money } from "./money";

/**
 * Deterministic time-value-of-money math (BUILD-SPEC.md §3.4). We never predict
 * markets: the rate of return is supplied by the user as a clearly labeled
 * assumption, and we show the resulting math exactly. All arithmetic runs
 * through decimal.js, so there is no floating-point drift on currency.
 */

export interface CompoundGrowthInput {
  /** Starting balance. */
  principal: number;
  /** Contribution added every period. */
  contribution: number;
  /** Nominal annual rate of return the user assumes (e.g. 0.06 for 6%). */
  annualRate: number;
  /** Number of years to project. */
  years: number;
  /** Compounding/contribution periods per year (12 = monthly, 1 = annual). */
  periodsPerYear: number;
  /** Contribute at the start of each period (annuity-due) vs the end. Default end. */
  contributeAtStart?: boolean;
}

export interface CompoundGrowthResult {
  /** Projected balance at the end of the horizon. */
  futureValue: Money;
  /** Principal plus every contribution (no growth). */
  totalContributed: Money;
  /** futureValue minus totalContributed — the growth from the assumed rate. */
  totalGrowth: Money;
  /** Total number of compounding periods. */
  periods: number;
}

/**
 * Future value of a present sum plus a level series of contributions, with
 * interest compounded each period. Contributions default to period-end
 * (ordinary annuity). A zero rate degenerates correctly to simple summation.
 */
export function compoundGrowth(input: CompoundGrowthInput): CompoundGrowthResult {
  const periods = Math.max(0, Math.round(input.years * input.periodsPerYear));
  const periodRate = new Decimal(input.annualRate).div(input.periodsPerYear);
  const growthFactor = periodRate.plus(1).pow(periods); // (1 + r)^n

  const principalFv = new Decimal(input.principal).times(growthFactor);

  let annuityFactor: Decimal;
  if (periodRate.isZero()) {
    annuityFactor = new Decimal(periods);
  } else {
    annuityFactor = growthFactor.minus(1).div(periodRate);
    if (input.contributeAtStart) annuityFactor = annuityFactor.times(periodRate.plus(1));
  }
  const contributionsFv = new Decimal(input.contribution).times(annuityFactor);

  const futureValue = Money.from(principalFv.plus(contributionsFv));
  const totalContributed = Money.from(input.principal).add(
    new Decimal(input.contribution).times(periods).toString(),
  );
  return {
    futureValue,
    totalContributed,
    totalGrowth: futureValue.subtract(totalContributed),
    periods,
  };
}

export interface PayoffResult {
  /** Whole months until the balance reaches zero. */
  months: number;
  /** Total interest paid over the payoff. */
  totalInterest: Money;
  /** Total paid (principal + interest). */
  totalPaid: Money;
}

/**
 * Months to pay off a debt at a fixed monthly payment (BUILD-SPEC.md §5.1,
 * "Freedom Date"). Iterates month by month in exact decimal so the interest
 * total is precise. Returns null when the payment can't cover the monthly
 * interest (the balance never falls — we surface that rather than show ∞).
 *
 * @param balance        current balance owed
 * @param annualRatePct  annual interest rate as a percentage (e.g. 22.99)
 * @param monthlyPayment fixed amount paid each month
 */
export function debtPayoff(
  balance: number,
  annualRatePct: number,
  monthlyPayment: number,
): PayoffResult | null {
  let bal = Money.from(Math.max(0, balance));
  if (bal.isZero()) {
    return { months: 0, totalInterest: Money.zero(), totalPaid: Money.zero() };
  }
  const payment = Money.from(Math.max(0, monthlyPayment));
  const monthlyRate = new Decimal(annualRatePct).div(100).div(12);

  let interestPaid = Money.zero();
  let paid = Money.zero();
  let months = 0;
  const MAX_MONTHS = 1200; // 100 years — beyond this we treat it as "never".

  while (bal.greaterThan(0) && months < MAX_MONTHS) {
    const interest = bal.multiply(monthlyRate);
    // A payment that can't even cover the interest never retires the debt.
    if (payment.lessThanOrEqual(interest)) return null;
    const owed = bal.add(interest);
    const pay = payment.greaterThan(owed) ? owed : payment; // final payment trims to the balance
    bal = owed.subtract(pay);
    interestPaid = interestPaid.add(interest);
    paid = paid.add(pay);
    months += 1;
  }

  if (bal.greaterThan(0)) return null;
  return { months, totalInterest: interestPaid, totalPaid: paid };
}

/**
 * Level monthly payment that amortizes a loan (BUILD-SPEC.md §3.3). Standard
 * mortgage formula M = P·r / (1 − (1+r)^−n); a zero rate degenerates to P/n.
 *
 * @param principal    amount borrowed
 * @param annualRatePct annual interest rate as a percentage
 * @param termYears     term in years
 */
export function monthlyMortgagePayment(
  principal: number,
  annualRatePct: number,
  termYears: number,
): Money {
  const n = Math.round(termYears * 12);
  if (n <= 0) return Money.zero();
  const r = new Decimal(annualRatePct).div(100).div(12);
  const p = new Decimal(principal);
  if (r.isZero()) return Money.from(p.div(n));
  const factor = r.plus(1).pow(-n); // (1+r)^-n
  return Money.from(p.times(r).div(new Decimal(1).minus(factor)));
}

/**
 * The loan principal a given monthly payment can support — the inverse of
 * {@link monthlyMortgagePayment}. Used by home-affordability: how big a mortgage
 * does my housing budget cover? P = M·(1 − (1+r)^−n) / r; zero rate → M·n.
 */
export function loanPrincipalFromPayment(
  monthlyPayment: number,
  annualRatePct: number,
  termYears: number,
): Money {
  const n = Math.round(termYears * 12);
  if (n <= 0) return Money.zero();
  const r = new Decimal(annualRatePct).div(100).div(12);
  const m = new Decimal(Math.max(0, monthlyPayment));
  if (r.isZero()) return Money.from(m.times(n));
  const factor = r.plus(1).pow(-n); // (1+r)^-n
  return Money.from(m.times(new Decimal(1).minus(factor)).div(r));
}
