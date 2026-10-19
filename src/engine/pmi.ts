/**
 * When private mortgage insurance ends, under the Homeowners Protection Act
 * (12 U.S.C. §§4901, 4902; SPEC-5 Phase 28).
 *
 * Three dates, each read off the loan's own amortization schedule:
 *
 *  - the **request** date: the balance first *scheduled* to reach the request
 *    share of the original value, or, by the borrower's option, the month it
 *    *actually* gets there with extra principal paid (§4901(2)(A));
 *  - the **automatic** date: the balance first scheduled to reach the
 *    automatic share (§4901(18)(A)). Extra payments never move it, because
 *    the statute reads it "based solely on the initial amortization schedule";
 *  - the **final** date: the month after the midpoint of the amortization
 *    period, whatever the balance (§4902(c)).
 *
 * The schedule is the level payment rounded to the cent, with each month's
 * interest rounded to the cent, which is how a servicer's schedule is printed.
 * Fixed-rate loans only: an adjustable loan reads "the amortization schedule
 * then in effect", which only its servicer holds.
 */
import Decimal from "decimal.js";
import { Money } from "./money";
import { clampMonths, monthlyMortgagePayment } from "./finance";

export interface PmiInput {
  /** The lesser of the contract price and the appraisal at closing (§4901(12)). */
  originalValue: number;
  /** Amount borrowed. */
  loanAmount: number;
  /** Annual interest rate as a percentage. */
  annualRatePct: number;
  termYears: number;
  /** Extra principal paid each month, which moves only the request date. */
  extraMonthly: number;
  /** The two lines, as shares of the original value, from the shard. */
  requestShare: number;
  automaticShare: number;
}

/** A point on the schedule: the payment that crosses the line, counted from 1. */
export interface PmiMilestone {
  payment: number;
}

export interface PmiResult {
  scheduledPayment: Money;
  /** Loan amount over original value, as a share. */
  startingShare: number;
  /** The loan starts at or under the request line, so PMI should not be required. */
  atOrUnderRequestLine: boolean;
  requestLine: Money;
  automaticLine: Money;
  /** On the original schedule. */
  request: PmiMilestone | null;
  /** With the extra principal; null when there is none. */
  requestWithExtra: PmiMilestone | null;
  automatic: PmiMilestone | null;
  /** The first payment after the midpoint of the amortization period. */
  final: PmiMilestone;
}

/** The first payment after which the balance is at or under `line`. */
function firstAtOrUnder(
  principal: Decimal,
  monthlyRate: Decimal,
  payment: Decimal,
  months: number,
  line: Decimal,
): PmiMilestone | null {
  let balance = principal;
  for (let n = 1; n <= months; n++) {
    const interest = balance.times(monthlyRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    balance = Decimal.max(0, balance.plus(interest).minus(payment));
    if (balance.lessThanOrEqualTo(line)) return { payment: n };
    if (balance.isZero()) return null;
  }
  return null;
}

export function pmiEndDates(input: PmiInput): PmiResult {
  const months = clampMonths(Math.max(1, input.termYears) * 12);
  const value = new Decimal(Math.max(0, input.originalValue));
  const principal = new Decimal(Math.max(0, input.loanAmount));
  const rate = new Decimal(Math.max(0, input.annualRatePct)).div(100).div(12);
  const scheduledPayment = monthlyMortgagePayment(
    principal.toNumber(),
    Math.max(0, input.annualRatePct),
    months / 12,
  ).roundToCents();
  const payment = new Decimal(scheduledPayment.toNumber());
  const requestLine = value.times(input.requestShare);
  const automaticLine = value.times(input.automaticShare);
  const extra = Math.max(0, input.extraMonthly);

  return {
    scheduledPayment,
    startingShare: value.isZero() ? 0 : principal.div(value).toNumber(),
    atOrUnderRequestLine: principal.lessThanOrEqualTo(requestLine),
    requestLine: Money.from(requestLine),
    automaticLine: Money.from(automaticLine),
    request: firstAtOrUnder(principal, rate, payment, months, requestLine),
    requestWithExtra:
      extra > 0 ? firstAtOrUnder(principal, rate, payment.plus(extra), months, requestLine) : null,
    automatic: firstAtOrUnder(principal, rate, payment, months, automaticLine),
    final: { payment: Math.floor(months / 2) + 1 },
  };
}
