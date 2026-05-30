import Decimal from "decimal.js";
import { Money } from "./money";
import { requiredMinimumDistribution } from "./rmd";
import type { RmdData } from "../data/schemas";

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
  const MAX_MONTHS = 1200; // 100 years, beyond this we treat it as "never".

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

/** A debt the freedom planner pays down: a balance, its rate, and a minimum. */
export interface PlannedDebt {
  name: string;
  /** Outstanding balance. */
  balance: number;
  /** Annual interest rate as a percentage (e.g. 22.99). */
  ratePct: number;
  /** Minimum monthly payment required on this debt. */
  minPayment: number;
}

/** "snowball" pays the smallest balance first; "avalanche" the highest rate first. */
export type DebtMethod = "snowball" | "avalanche";

export interface DebtMethodResult {
  method: DebtMethod;
  /** Whole months until every debt is gone, or null when the budget can't retire them. */
  months: number | null;
  /** Total interest paid across all debts over the payoff. */
  totalInterest: Money;
  /** Each debt and the month it hits zero, in the order they are retired. */
  payoffOrder: { name: string; month: number }[];
}

export interface DebtFreedomResult {
  snowball: DebtMethodResult;
  avalanche: DebtMethodResult;
  /** Interest the avalanche saves over the snowball (≥ 0), or null if either never pays off. */
  interestSaved: Money | null;
  /** Months the avalanche saves over the snowball (≥ 0), or null if either never pays off. */
  monthsSaved: number | null;
  /** Total applied each month: the minimums plus the extra. */
  monthlyTotal: number;
  /** Sum of the minimum payments across all debts. */
  totalMinimum: number;
}

/** Fixed payoff order for a method: snowball by balance ascending, avalanche by rate descending.
 *  Ties (and ties only) fall back to the original entry order, so the result is deterministic. */
function methodOrder(debts: PlannedDebt[], method: DebtMethod): number[] {
  return debts
    .map((d, i) => ({ i, d }))
    .sort((a, b) =>
      method === "snowball"
        ? a.d.balance - b.d.balance || a.i - b.i
        : b.d.ratePct - a.d.ratePct || a.i - b.i,
    )
    .map((x) => x.i);
}

/**
 * Simulate paying off a set of debts with a fixed total monthly budget, rolling
 * each cleared debt's payment into the next target (the "debt snowball" engine).
 * Every active debt pays its minimum; whatever the budget has left lands on the
 * target debt, and as debts clear their freed-up minimums grow the amount thrown
 * at the next one. Deterministic, exact-decimal month-by-month arithmetic.
 */
function simulateDebtMethod(
  debts: PlannedDebt[],
  monthlyTotal: number,
  method: DebtMethod,
): DebtMethodResult {
  const order = methodOrder(debts, method);
  const bals = debts.map((d) => Money.from(Math.max(0, d.balance)));
  const minPayments = debts.map((d) => Money.from(Math.max(0, d.minPayment)));
  const monthlyRates = debts.map((d) => new Decimal(d.ratePct).div(100).div(12));
  const cleared = debts.map((d) => Money.from(Math.max(0, d.balance)).isZero());

  let totalInterest = Money.zero();
  let months = 0;
  const payoffOrder: { name: string; month: number }[] = [];
  // Debts already at zero are "retired" at month 0, in method order.
  for (const i of order) if (cleared[i]) payoffOrder.push({ name: debts[i]!.name, month: 0 });

  const MAX_MONTHS = 1200; // 100 years; beyond this we treat the plan as "never".
  while (order.some((i) => bals[i]!.greaterThan(0)) && months < MAX_MONTHS) {
    months += 1;
    // 1. Accrue this month's interest on every active debt.
    for (const i of order) {
      if (bals[i]!.isZero()) continue;
      const interest = bals[i]!.multiply(monthlyRates[i]!);
      bals[i] = bals[i]!.add(interest);
      totalInterest = totalInterest.add(interest);
    }
    // 2. Pay each active debt its minimum (trimmed to the balance), tracking the leftover.
    let budget = Money.from(monthlyTotal);
    for (const i of order) {
      if (bals[i]!.isZero()) continue;
      const pay = minPayments[i]!.greaterThan(bals[i]!) ? bals[i]! : minPayments[i]!;
      bals[i] = bals[i]!.subtract(pay);
      budget = budget.subtract(pay);
    }
    // 3. Throw everything left at the target, cascading to the next as each clears.
    for (const i of order) {
      if (!budget.greaterThan(0)) break;
      if (bals[i]!.isZero()) continue;
      const pay = budget.greaterThan(bals[i]!) ? bals[i]! : budget;
      bals[i] = bals[i]!.subtract(pay);
      budget = budget.subtract(pay);
    }
    // 4. Record any debt that reached zero this month, in method order.
    for (const i of order) {
      if (!cleared[i] && bals[i]!.isZero()) {
        cleared[i] = true;
        payoffOrder.push({ name: debts[i]!.name, month: months });
      }
    }
  }

  const debtFree = order.every((i) => bals[i]!.isZero());
  return {
    method,
    months: debtFree ? months : null,
    totalInterest,
    payoffOrder,
  };
}

/**
 * Compare the two classic debt-payoff orders (BUILD-SPEC-2 §6.2): the snowball
 * (smallest balance first, for quick wins and momentum) and the avalanche
 * (highest rate first, mathematically cheapest). Both run the same fixed monthly
 * budget, the sum of the minimums plus an extra amount, and roll freed-up
 * payments forward. Returns each method's months and interest, plus what the
 * avalanche saves. Deterministic; nothing to cite (pure arithmetic on the user's
 * own balances and rates).
 *
 * @param debts  the debts to retire (balance, rate, minimum)
 * @param extra  extra paid each month beyond the sum of the minimums (≥ 0)
 */
export function debtFreedomPlan(debts: PlannedDebt[], extra: number): DebtFreedomResult {
  const active = debts.filter((d) => d.balance > 0);
  const totalMinimum = active.reduce((sum, d) => sum + Math.max(0, d.minPayment), 0);
  const monthlyTotal = totalMinimum + Math.max(0, extra);

  const snowball = simulateDebtMethod(active, monthlyTotal, "snowball");
  const avalanche = simulateDebtMethod(active, monthlyTotal, "avalanche");

  const bothPayOff = snowball.months !== null && avalanche.months !== null;
  return {
    snowball,
    avalanche,
    interestSaved: bothPayOff ? snowball.totalInterest.subtract(avalanche.totalInterest) : null,
    monthsSaved: bothPayOff ? snowball.months! - avalanche.months! : null,
    monthlyTotal,
    totalMinimum,
  };
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

export interface HourlyPayInput {
  /** Pay rate for regular hours. */
  hourlyRate: number;
  /** Regular hours worked each week. */
  hoursPerWeek: number;
  /** Overtime hours each week, paid at 1.5× the regular rate. */
  overtimeHoursPerWeek: number;
  /** Weeks worked per year (52 for a full year). */
  weeksPerYear: number;
}

/**
 * Annualize an hourly wage (BUILD-SPEC.md §3.1). Regular hours pay the base
 * rate; overtime hours pay 1.5× the base rate (the FLSA convention). Pure
 * arithmetic on the user's own pay — no rule to cite, only their numbers.
 */
export function annualFromHourly(input: HourlyPayInput): Money {
  const rate = new Decimal(Math.max(0, input.hourlyRate));
  const weeks = new Decimal(Math.max(0, input.weeksPerYear));
  const regularWeekly = rate.times(Math.max(0, input.hoursPerWeek));
  const overtimeWeekly = rate.times(1.5).times(Math.max(0, input.overtimeHoursPerWeek));
  return Money.from(regularWeekly.plus(overtimeWeekly).times(weeks));
}

/**
 * The equivalent hourly rate for an annual salary, given the regular hours and
 * weeks worked. The inverse of {@link annualFromHourly} for the no-overtime
 * case. Returns zero when there are no hours to divide across.
 */
export function hourlyFromAnnual(
  annual: number,
  hoursPerWeek: number,
  weeksPerYear: number,
): Money {
  const totalHours = new Decimal(Math.max(0, hoursPerWeek)).times(Math.max(0, weeksPerYear));
  if (totalHours.isZero()) return Money.zero();
  return Money.from(new Decimal(Math.max(0, annual)).div(totalHours));
}

export interface AmortizationInput {
  /** Amount borrowed. */
  principal: number;
  /** Annual interest rate as a percentage (e.g. 6.5). */
  annualRatePct: number;
  /** Loan term in years. */
  termYears: number;
  /** Extra amount paid toward principal each month (the "what-if"). */
  extraMonthly: number;
}

export interface AmortizationResult {
  /** Scheduled monthly payment (principal + interest), rounded to cents. */
  scheduledPayment: Money;
  /** Months to payoff with the extra payment applied. */
  payoffMonths: number;
  /** Total interest paid with the extra payment applied. */
  totalInterest: Money;
  /** Total paid (principal + interest) with the extra payment applied. */
  totalPaid: Money;
  /** Months to payoff on the scheduled payment alone (no extra). */
  baselineMonths: number;
  /** Total interest on the scheduled payment alone. */
  baselineInterest: Money;
  /** Interest saved by the extra payment. */
  interestSaved: Money;
  /** Months shaved off by the extra payment. */
  monthsSaved: number;
}

/**
 * Loan amortization with an extra-payment what-if (BUILD-SPEC.md §3.3). The
 * scheduled payment comes from {@link monthlyMortgagePayment}; both the baseline
 * and the with-extra payoff are run through {@link debtPayoff} so the interest
 * totals are computed by the same exact month-by-month engine and agree at
 * extra = 0. The rate is the loan's own terms, so there is no external rule to
 * cite — the user's numbers are the inputs.
 */
export function amortizationSummary(input: AmortizationInput): AmortizationResult {
  const scheduledPayment = monthlyMortgagePayment(
    input.principal,
    input.annualRatePct,
    input.termYears,
  ).roundToCents();
  const base = scheduledPayment.toNumber();
  const extra = Math.max(0, input.extraMonthly);

  const zero: PayoffResult = { months: 0, totalInterest: Money.zero(), totalPaid: Money.zero() };
  const baseline = debtPayoff(input.principal, input.annualRatePct, base) ?? zero;
  const withExtra = debtPayoff(input.principal, input.annualRatePct, base + extra) ?? baseline;

  const interestSaved = baseline.totalInterest.subtract(withExtra.totalInterest);
  return {
    scheduledPayment,
    payoffMonths: withExtra.months,
    totalInterest: withExtra.totalInterest,
    totalPaid: withExtra.totalPaid,
    baselineMonths: baseline.months,
    baselineInterest: baseline.totalInterest,
    interestSaved: interestSaved.isNegative() ? Money.zero() : interestSaved,
    monthsSaved: Math.max(0, baseline.months - withExtra.months),
  };
}

export interface CashFlowEvent {
  /** Day of the month (1–31). */
  day: number;
  /** Signed amount: positive for income, negative for a bill. */
  amount: number;
  label?: string;
}

export interface CashFlowDay {
  day: number;
  /** Net change on that day (sum of its events). */
  net: number;
  /** Running balance at the end of that day. */
  balance: number;
}

export interface CashFlowResult {
  /** Only the days that have at least one event, in order, with running balance. */
  days: CashFlowDay[];
  /** Balance after the last event of the month. */
  endingBalance: Money;
  /** The lowest end-of-day balance reached (including the starting balance). */
  minBalance: Money;
  /** The day the low is hit (0 when the starting balance is never beaten down). */
  minDay: number;
  /** True when the balance dips below zero at any point. */
  goesNegative: boolean;
}

/**
 * Cash-flow timeline (BUILD-SPEC-2 §6.1): walk a month day by day, applying each
 * dated income and bill to a running balance, to spot the tightest day (and any
 * day the balance would go negative). Deterministic arithmetic on the user's own
 * dated amounts — nothing to cite.
 */
export function cashFlowTimeline(startingBalance: number, events: CashFlowEvent[]): CashFlowResult {
  const byDay = new Map<number, number>();
  for (const e of events) {
    const d = Math.max(1, Math.min(31, Math.round(e.day)));
    byDay.set(d, (byDay.get(d) ?? 0) + e.amount);
  }
  let balance = Money.from(startingBalance);
  let minBalance = balance;
  let minDay = 0;
  const days: CashFlowDay[] = [];
  for (let d = 1; d <= 31; d++) {
    const net = byDay.get(d);
    if (net === undefined) continue;
    balance = balance.add(net);
    days.push({ day: d, net, balance: balance.toNumber() });
    if (balance.lessThan(minBalance)) {
      minBalance = balance;
      minDay = d;
    }
  }
  return {
    days,
    endingBalance: balance,
    minBalance,
    minDay,
    goesNegative: minBalance.isNegative(),
  };
}

export interface LifeInsuranceInput {
  /** Annual income to replace for survivors. */
  annualIncome: number;
  /** Years of income to replace. */
  yearsToReplace: number;
  /** Non-mortgage debts to clear. */
  debts: number;
  /** Mortgage balance to pay off. */
  mortgageBalance: number;
  /** Final expenses (funeral, medical, estate). */
  finalExpenses: number;
  /** Future obligations such as children's education. */
  futureObligations: number;
  /** Life insurance already in force. */
  existingCoverage: number;
  /** Liquid assets (savings, investments) that offset the need. */
  liquidAssets: number;
}

export interface LifeInsuranceResult {
  /** Income to replace: annual income × years. */
  incomeReplacement: Money;
  /** Gross need before offsets (income replacement + debts + mortgage + final + future). */
  totalNeed: Money;
  /** Recommended new coverage: gross need less existing coverage and liquid assets (≥ 0). */
  recommendedCoverage: Money;
}

/**
 * Life-insurance needs, the transparent "DIME"-style method (BUILD-SPEC-2 §6.6):
 * replace several years of income, clear Debts and the Mortgage, cover final
 * expenses and future obligations (Education), then subtract coverage already in
 * force and liquid assets. Deterministic from the inputs — not advice, and no
 * external rule to cite.
 */
export function lifeInsuranceNeed(input: LifeInsuranceInput): LifeInsuranceResult {
  const nn = (n: number): number => Math.max(0, n);
  const years = Math.max(0, Math.round(input.yearsToReplace));
  const incomeReplacement = Money.from(nn(input.annualIncome)).multiply(years);
  const totalNeed = incomeReplacement
    .add(nn(input.debts))
    .add(nn(input.mortgageBalance))
    .add(nn(input.finalExpenses))
    .add(nn(input.futureObligations));
  const recommended = totalNeed
    .subtract(nn(input.existingCoverage))
    .subtract(nn(input.liquidAssets));
  return {
    incomeReplacement,
    totalNeed,
    recommendedCoverage: recommended.isNegative() ? Money.zero() : recommended,
  };
}

export interface SinkingFundInput {
  /** Amount already saved toward the goal. */
  currentSaved: number;
  /** The target amount to reach. */
  target: number;
  /** Months until the goal date. */
  months: number;
  /** Assumed annual return on the savings, as a percentage (the user's assumption). */
  annualReturnPct: number;
}

export interface SinkingFundResult {
  /** Level monthly contribution needed to hit the target by the date. */
  monthlyContribution: Money;
  /** What today's balance alone grows to by the date, with no contributions. */
  projectedFromCurrent: Money;
  /** True when today's balance already reaches the target on its own. */
  alreadyOnTrack: boolean;
  /** monthlyContribution × months — the total you'd put in. */
  totalContributed: Money;
}

/**
 * Sinking-fund planner (BUILD-SPEC-2 §6.3): the level monthly contribution that
 * reaches a target by a date, given what's already saved and an assumed return.
 * Solves the future-value-of-an-annuity equation for the payment. A zero rate
 * degenerates to (remaining ÷ months). The return is the user's assumption,
 * clearly labeled; we never predict markets (§2.1).
 */
export function requiredMonthlyContribution(input: SinkingFundInput): SinkingFundResult {
  const months = Math.max(0, Math.round(input.months));
  const i = new Decimal(input.annualReturnPct).div(100).div(12);
  const pv = new Decimal(Math.max(0, input.currentSaved));
  const fv = new Decimal(Math.max(0, input.target));
  const growth = i.plus(1).pow(months);
  const projected = pv.times(growth);
  const projectedMoney = Money.from(projected);

  const remaining = fv.minus(projected);
  if (months === 0 || remaining.lessThanOrEqualTo(0)) {
    return {
      monthlyContribution: Money.zero(),
      projectedFromCurrent: projectedMoney,
      alreadyOnTrack: remaining.lessThanOrEqualTo(0),
      totalContributed: Money.zero(),
    };
  }

  const pmt = i.isZero() ? remaining.div(months) : remaining.times(i).div(growth.minus(1));
  const pmtMoney = Money.from(pmt);
  return {
    monthlyContribution: pmtMoney,
    projectedFromCurrent: projectedMoney,
    alreadyOnTrack: false,
    totalContributed: pmtMoney.multiply(months),
  };
}

export interface HealthPlanInput {
  /** Monthly premium. */
  monthlyPremium: number;
  /** Annual deductible. */
  deductible: number;
  /** Member's share of costs after the deductible (0–1, e.g. 0.2 for 20%). */
  coinsuranceRate: number;
  /** Annual out-of-pocket maximum (caps total member cost on claims). */
  outOfPocketMax: number;
  /** Expected total medical spend for the year (the user's estimate). */
  expectedAnnualSpend: number;
}

export interface HealthPlanResult {
  /** Premiums for the year (monthly × 12). */
  annualPremium: Money;
  /** Out-of-pocket on claims (deductible + coinsurance), capped at the OOP max. */
  memberCost: Money;
  /** annualPremium + memberCost — the all-in cost for the year. */
  totalAnnualCost: Money;
}

/**
 * Health-plan annual cost (BUILD-SPEC-2 §6.4). Deterministic from the plan terms
 * and the user's expected spend: you pay the full cost up to the deductible, then
 * the coinsurance share above it, with total out-of-pocket on claims capped at
 * the out-of-pocket maximum. Add the premiums to get the all-in cost. Comparing
 * two plans is just two of these.
 */
export function healthPlanAnnualCost(input: HealthPlanInput): HealthPlanResult {
  const annualPremium = Money.from(Math.max(0, input.monthlyPremium)).multiply(12);
  const spend = Math.max(0, input.expectedAnnualSpend);
  const deductible = Math.max(0, input.deductible);
  const coins = Math.min(1, Math.max(0, input.coinsuranceRate));
  const oopMax = Math.max(0, input.outOfPocketMax);

  let member = spend <= deductible ? spend : deductible + (spend - deductible) * coins;
  member = Math.min(member, oopMax);
  const memberCost = Money.from(member);
  return { annualPremium, memberCost, totalAnnualCost: annualPremium.add(memberCost) };
}

/**
 * Remaining loan balance after `monthsPaid` scheduled payments. Closed form:
 * balance = P·(1+i)^k − PMT·((1+i)^k − 1)/i, with a zero-rate branch. Internal
 * helper for {@link rentVsBuy}.
 */
function remainingLoanBalance(
  loan: number,
  annualRatePct: number,
  termYears: number,
  monthsPaid: number,
): Decimal {
  const n = Math.round(termYears * 12);
  const k = Math.min(Math.max(0, Math.round(monthsPaid)), n);
  const P = new Decimal(Math.max(0, loan));
  if (k >= n || n <= 0) return new Decimal(0);
  const r = new Decimal(annualRatePct).div(100).div(12);
  if (r.isZero()) return P.minus(P.div(n).times(k));
  const pmt = P.times(r).div(new Decimal(1).minus(r.plus(1).pow(-n)));
  const g = r.plus(1).pow(k);
  return P.times(g).minus(pmt.times(g.minus(1).div(r)));
}

export interface RentVsBuyInput {
  homePrice: number;
  downPayment: number;
  mortgageRatePct: number;
  termYears: number;
  /** Monthly ownership costs beyond principal & interest (tax, insurance, maintenance, HOA). */
  monthlyOwnershipCosts: number;
  /** Up-front closing costs to buy. */
  closingCostBuy: number;
  /** Selling costs as a percentage of the sale price (agent fees, etc.). */
  sellingCostPct: number;
  /** Assumed annual home appreciation (percentage). */
  homeAppreciationPct: number;
  monthlyRent: number;
  /** Assumed annual rent growth (percentage). */
  rentGrowthPct: number;
  /** Assumed annual return on money not tied up in the home (percentage). */
  investmentReturnPct: number;
  /** Horizon in years. */
  years: number;
}

export interface RentVsBuyResult {
  /** Net cost of buying over the horizon (cash out − sale proceeds). */
  netCostBuy: Money;
  /** Net cost of renting over the horizon (rent − investment gain on the freed cash). */
  netCostRent: Money;
  /** The monthly principal & interest payment used for the buy path. */
  monthlyPayment: Money;
  /** Which path costs less over the horizon. */
  cheaper: "buy" | "rent" | "tie";
  /** Absolute difference between the two net costs. */
  difference: Money;
}

/**
 * Rent vs buy over a chosen horizon (BUILD-SPEC-2 §6.3). A deterministic
 * net-cost comparison: buying's net cost is all cash out (down payment, closing,
 * principal & interest, ownership costs) minus the sale proceeds (appreciated
 * value less selling costs and the remaining loan balance); renting's net cost
 * is the rent paid (growing annually) minus the investment gain on the cash a
 * renter doesn't tie up. Lower wins. Appreciation, rent growth, and the
 * investment return are all the user's assumptions, clearly labeled — never
 * forecasts (§2.1). Carrying costs are held flat (a stated simplification), and
 * the monthly cash-flow difference is not separately invested.
 */
export function rentVsBuy(input: RentVsBuyInput): RentVsBuyResult {
  const years = Math.max(0, Math.round(input.years));
  const months = years * 12;
  const loan = Math.max(0, input.homePrice - input.downPayment);
  const monthlyPayment = monthlyMortgagePayment(loan, input.mortgageRatePct, input.termYears);
  const termMonths = Math.round(input.termYears * 12);
  const piPaid = monthlyPayment.multiply(Math.min(months, termMonths));
  const ownershipPaid = Money.from(Math.max(0, input.monthlyOwnershipCosts)).multiply(months);

  const upfrontBuy = new Decimal(Math.max(0, input.downPayment)).plus(
    Math.max(0, input.closingCostBuy),
  );
  const apprFactor = new Decimal(input.homeAppreciationPct).div(100).plus(1).pow(years);
  const terminalValue = new Decimal(input.homePrice).times(apprFactor);
  const balance = remainingLoanBalance(loan, input.mortgageRatePct, input.termYears, months);
  const saleProceeds = terminalValue
    .times(new Decimal(1).minus(new Decimal(input.sellingCostPct).div(100)))
    .minus(balance);
  const netCostBuy = Money.from(upfrontBuy)
    .add(piPaid)
    .add(ownershipPaid)
    .subtract(Money.from(saleProceeds));

  const invFactor = new Decimal(input.investmentReturnPct).div(100).plus(1).pow(years);
  const investmentGain = upfrontBuy.times(invFactor).minus(upfrontBuy);
  const rentGrowth = new Decimal(input.rentGrowthPct).div(100);
  let totalRent = new Decimal(0);
  for (let y = 0; y < years; y++) {
    totalRent = totalRent.plus(
      new Decimal(Math.max(0, input.monthlyRent)).times(12).times(rentGrowth.plus(1).pow(y)),
    );
  }
  const netCostRent = Money.from(totalRent).subtract(Money.from(investmentGain));

  const diff = netCostBuy.subtract(netCostRent);
  const cheaper = diff.isZero() ? "tie" : diff.isNegative() ? "buy" : "rent";
  return { netCostBuy, netCostRent, monthlyPayment, cheaper, difference: diff.abs() };
}

export interface CoastFireInput {
  /** Invested balance today. */
  currentBalance: number;
  /** Assumed real (after-inflation) annual return, as a percentage (e.g. 5). */
  annualRealReturnPct: number;
  /** Years from now until the target date (e.g. retirement age − current age). */
  years: number;
  /** The target balance to coast to (e.g. My Enough Number). */
  targetNumber: number;
}

export interface CoastFireResult {
  /** Today's balance grown for `years` at the assumed rate, with no new saving. */
  projected: Money;
  /** The balance you'd need today to coast exactly to the target by then. */
  coastNumber: Money;
  /** True once today's balance alone would reach the target — the Downshift Point. */
  reached: boolean;
  /** How much more you'd need today to reach the Downshift Point (0 once reached). */
  gap: Money;
}

/**
 * Downshift Point / coast-FIRE projection (BUILD-SPEC.md §5.1). Given a balance
 * today and an assumed real return, project what it grows to by the target date
 * with NO further contributions, and the "coast number" — the balance today that
 * would coast exactly to the target. Once today's balance reaches the coast
 * number, continued saving is optional. The return is the user's assumption,
 * clearly labeled; we never predict markets (§2.1).
 */
export function coastFireProjection(input: CoastFireInput): CoastFireResult {
  const r = new Decimal(input.annualRealReturnPct).div(100);
  const years = Math.max(0, input.years);
  const factor = r.plus(1).pow(years); // (1 + r)^years
  const projected = Money.from(new Decimal(input.currentBalance).times(factor));
  const coastNumber = factor.isZero()
    ? Money.from(input.targetNumber)
    : Money.from(new Decimal(input.targetNumber).div(factor));
  const reached = projected.greaterThanOrEqual(input.targetNumber);
  const gap = coastNumber.subtract(input.currentBalance);
  return { projected, coastNumber, reached, gap: gap.isNegative() ? Money.zero() : gap };
}

export interface SabbaticalInput {
  /** Savings set aside for the break. */
  savings: number;
  /** Essential monthly spending during the break. */
  monthlyEssentialBurn: number;
  /** Length of the break in months (0 for a pure big-purchase question). */
  breakMonths: number;
  /** Any income still coming in during the break (part-time, rental, etc.). */
  monthlyIncomeDuringBreak: number;
  /** A one-time cost on top of living expenses (the "big purchase"). */
  oneTimeCost: number;
}

export interface SabbaticalResult {
  /** Net monthly draw on savings (burn − income, never negative). */
  netMonthlyDraw: Money;
  /** Total cost of the break: net draw × months + the one-time cost. */
  totalCost: Money;
  /** Savings left afterward (negative when it's not covered). */
  remaining: Money;
  /** True when savings cover the whole plan. */
  affordable: boolean;
  /** Months of runway the remaining savings buy at the essential burn. */
  runwayAfterMonths: number;
}

/**
 * Sabbatical and big-purchase planner (BUILD-SPEC.md §5.2). Deterministic
 * arithmetic on the user's own numbers: what a break (or a one-time purchase)
 * costs, whether current savings cover it, and the runway left afterward. Framed
 * calmly — it answers "can I afford this, and what does it leave me?" without
 * shame (§5.3).
 */
export function sabbaticalPlan(input: SabbaticalInput): SabbaticalResult {
  const burn = Money.from(Math.max(0, input.monthlyEssentialBurn));
  const income = Money.from(Math.max(0, input.monthlyIncomeDuringBreak));
  let netDraw = burn.subtract(income);
  if (netDraw.isNegative()) netDraw = Money.zero();

  const months = Math.max(0, Math.round(input.breakMonths));
  const totalCost = netDraw.multiply(months).add(Math.max(0, input.oneTimeCost));
  const remaining = Money.from(Math.max(0, input.savings)).subtract(totalCost);
  const affordable = !remaining.isNegative();

  const burnNum = burn.toNumber();
  const runwayAfterMonths =
    affordable && burnNum > 0 ? Math.min(1200, remaining.toNumber() / burnNum) : 0;

  return { netMonthlyDraw: netDraw, totalCost, remaining, affordable, runwayAfterMonths };
}

export interface RefinanceInput {
  /** Current loan balance being refinanced. */
  balance: number;
  /** Current loan's annual rate as a percentage. */
  currentRatePct: number;
  /** Years remaining on the current loan. */
  currentRemainingYears: number;
  /** Proposed new loan's annual rate as a percentage. */
  newRatePct: number;
  /** Proposed new loan's term in years. */
  newTermYears: number;
  /** Up-front closing costs to refinance. */
  closingCosts: number;
}

export interface RefinanceResult {
  /** Monthly payment on the current loan over its remaining term. */
  currentPayment: Money;
  /** Monthly payment on the proposed new loan. */
  newPayment: Money;
  /** currentPayment − newPayment; negative when the new loan costs more. */
  monthlySavings: Money;
  /** Whole months to recoup the closing costs from the monthly savings, or
   *  null when the new payment isn't lower (there is nothing to recoup). */
  breakEvenMonths: number | null;
  /** Interest left to pay on the current loan over its remaining term. */
  currentRemainingInterest: Money;
  /** Total interest over the full new loan term. */
  newTotalInterest: Money;
}

/**
 * Refinance break-even (BUILD-SPEC.md §3.3): compare the current loan's payment
 * to a proposed new loan's payment and report how many months of monthly
 * savings it takes to recoup the closing costs. The rate is the loan's own
 * terms, so there is no external rule to cite. A new payment that isn't lower
 * yields a null break-even (we surface "no break-even" rather than a negative).
 */
export function refinanceBreakEven(input: RefinanceInput): RefinanceResult {
  const currentPayment = monthlyMortgagePayment(
    input.balance,
    input.currentRatePct,
    input.currentRemainingYears,
  );
  const newPayment = monthlyMortgagePayment(input.balance, input.newRatePct, input.newTermYears);
  const monthlySavings = currentPayment.subtract(newPayment);

  const closing = Money.from(Math.max(0, input.closingCosts));
  let breakEvenMonths: number | null = null;
  if (monthlySavings.greaterThan(0)) {
    breakEvenMonths = Math.ceil(closing.divide(monthlySavings.toNumber()).toNumber());
  }

  const currentMonths = Math.round(input.currentRemainingYears * 12);
  const newMonths = Math.round(input.newTermYears * 12);
  const balance = Money.from(input.balance);
  const currentRemainingInterest = currentPayment.multiply(currentMonths).subtract(balance);
  const newTotalInterest = newPayment.multiply(newMonths).subtract(balance);

  return {
    currentPayment,
    newPayment,
    monthlySavings,
    breakEvenMonths,
    currentRemainingInterest,
    newTotalInterest,
  };
}

export interface DisabilityNeedInput {
  /** Gross annual income to protect. */
  annualIncome: number;
  /** Share of income to replace if you can't work, as a percentage (e.g. 60). */
  replacementRatePct: number;
  /** Disability benefit you already have, monthly (e.g. group long-term disability). */
  existingMonthlyBenefit: number;
  /** Other monthly income that would continue (e.g. a spouse's earmarked income). */
  otherMonthlyIncome: number;
}

export interface DisabilityNeedResult {
  /** Monthly income you're aiming to replace (income × rate ÷ 12). */
  targetMonthly: Money;
  /** Monthly income already covered (existing benefit + other income). */
  coveredMonthly: Money;
  /** The monthly coverage gap to close (≥ 0). */
  monthlyGap: Money;
  /** The annual coverage gap (monthly × 12). */
  annualGap: Money;
}

/**
 * Disability-insurance need (BUILD-SPEC-2 §6.6): the monthly income gap if you
 * couldn't work. Replace a chosen share of income (a labeled assumption, often
 * ~60% for group long-term disability), then subtract coverage and other income
 * you'd still have. Deterministic from the inputs — not advice, no rule to cite.
 */
export function disabilityCoverageNeed(input: DisabilityNeedInput): DisabilityNeedResult {
  const rate = new Decimal(Math.max(0, input.replacementRatePct)).div(100);
  const targetMonthly = Money.from(Math.max(0, input.annualIncome)).multiply(rate).divide(12);
  const coveredMonthly = Money.from(Math.max(0, input.existingMonthlyBenefit)).add(
    Math.max(0, input.otherMonthlyIncome),
  );
  const gap = targetMonthly.subtract(coveredMonthly);
  const monthlyGap = gap.isNegative() ? Money.zero() : gap;
  return {
    targetMonthly,
    coveredMonthly,
    monthlyGap,
    annualGap: monthlyGap.multiply(12),
  };
}

export interface UmbrellaNeedInput {
  /** Net worth a lawsuit could reach (assets to protect). */
  netWorth: number;
  /** Extra future-income exposure to cover beyond net worth (optional, ≥ 0). */
  futureIncomeExposure: number;
  /** Liability coverage you already carry (auto + home limits combined). */
  existingLiabilityCoverage: number;
  /** Increment umbrella policies are sold in (typically $1,000,000). */
  policyIncrement: number;
}

export interface UmbrellaNeedResult {
  /** Total exposure to protect (net worth + future-income exposure). */
  exposure: Money;
  /** Exposure not already covered by existing liability limits (≥ 0). */
  uncoveredExposure: Money;
  /** Recommended umbrella, the uncovered exposure rounded up to a whole policy increment. */
  recommendedUmbrella: Money;
}

/**
 * Umbrella-liability sizing (BUILD-SPEC-2 §6.6): the common guideline is to
 * carry umbrella coverage at least equal to your net worth (what a judgment
 * could reach), above your auto and home liability limits. We round the
 * uncovered exposure up to the increment umbrella is sold in. A labeled
 * guideline, not a cited rule.
 */
export function umbrellaCoverageNeed(input: UmbrellaNeedInput): UmbrellaNeedResult {
  const exposure = Money.from(Math.max(0, input.netWorth)).add(
    Math.max(0, input.futureIncomeExposure),
  );
  const uncovered = exposure.subtract(Math.max(0, input.existingLiabilityCoverage));
  const uncoveredExposure = uncovered.isNegative() ? Money.zero() : uncovered;
  const increment = Math.max(1, input.policyIncrement);
  const layers = Math.ceil(uncoveredExposure.toNumber() / increment);
  return {
    exposure,
    uncoveredExposure,
    recommendedUmbrella: Money.from(layers * increment),
  };
}

export interface RetirementDrawdownInput {
  /** Balance at the start of retirement. */
  currentBalance: number;
  /** Age at the start of the projection. */
  currentAge: number;
  /** Annual amount to withdraw, in today's dollars. */
  annualWithdrawal: number;
  /**
   * Real (after-inflation) return as a percentage. Using a real return keeps the
   * whole projection in today's dollars — honest, and no market forecast (§2.1).
   */
  realReturnPct: number;
  /** Age to project to (default 100). */
  maxAge?: number;
}

export interface DrawdownYear {
  age: number;
  /** Balance at the start of the year (the prior year-end balance). */
  startBalance: Money;
  /** Required minimum distribution for the year (0 before the begin age). */
  rmd: Money;
  /** Amount actually withdrawn: the greater of the chosen draw and the RMD. */
  withdrawal: Money;
  /** Balance at year end, after the withdrawal grows at the real return. */
  endBalance: Money;
}

export interface RetirementDrawdownResult {
  timeline: DrawdownYear[];
  /** Age the balance is exhausted, or null if it lasts to maxAge. */
  depletedAtAge: number | null;
  /** Whole years the savings support withdrawals from currentAge. */
  yearsLasting: number;
  /** First age a required minimum distribution applies (null if none). */
  firstRmdAge: number | null;
  /** Total withdrawn across the projection. */
  totalWithdrawn: Money;
  /** True when the balance still has money at maxAge. */
  lastsToMaxAge: boolean;
}

/**
 * Retirement drawdown and RMD timeline (BUILD-SPEC-2 §6.7). Projects the balance
 * year by year in today's dollars (a real return, never a nominal forecast):
 * each year withdraws the greater of the chosen amount and the required minimum
 * distribution (from the bundled IRS table, when provided), then grows the
 * remainder. Reports how long the money lasts and when RMDs begin.
 */
export function retirementDrawdown(
  input: RetirementDrawdownInput,
  rmdData?: RmdData | null,
): RetirementDrawdownResult {
  const maxAge = Math.round(input.maxAge ?? 100);
  const startAge = Math.round(input.currentAge);
  const realRate = new Decimal(input.realReturnPct).div(100);
  const withdrawalAmt = Math.max(0, input.annualWithdrawal);

  let balance = Money.from(Math.max(0, input.currentBalance));
  const timeline: DrawdownYear[] = [];
  let depletedAtAge: number | null = null;
  let firstRmdAge: number | null = null;
  let totalWithdrawn = Money.zero();

  for (let age = startAge; age <= maxAge; age++) {
    if (!balance.greaterThan(0)) break;
    const startBalance = balance;

    let rmd = Money.zero();
    if (rmdData) {
      const r = requiredMinimumDistribution(age, startBalance.toNumber(), rmdData);
      if (r.required) {
        rmd = r.amount;
        if (firstRmdAge === null) firstRmdAge = age;
      }
    }

    let withdrawal = Money.from(withdrawalAmt);
    if (rmd.greaterThan(withdrawal)) withdrawal = rmd;
    if (withdrawal.greaterThan(startBalance)) withdrawal = startBalance;
    totalWithdrawn = totalWithdrawn.add(withdrawal);

    const afterWithdrawal = startBalance.subtract(withdrawal);
    const endBalance = afterWithdrawal.add(afterWithdrawal.multiply(realRate));
    timeline.push({ age, startBalance, rmd, withdrawal, endBalance });
    balance = endBalance.isNegative() ? Money.zero() : endBalance;

    if (!balance.greaterThan(0)) {
      depletedAtAge = age;
      break;
    }
  }

  const lastsToMaxAge = depletedAtAge === null;
  return {
    timeline,
    depletedAtAge,
    yearsLasting: depletedAtAge === null ? maxAge - startAge : depletedAtAge - startAge + 1,
    firstRmdAge,
    totalWithdrawn,
    lastsToMaxAge,
  };
}

export interface CollegeCostInput {
  /** One year's all-in college cost in today's dollars. */
  annualCostToday: number;
  /** Years until the first year of college. */
  yearsUntilStart: number;
  /** Number of years of college to fund (e.g. 4). */
  yearsOfCollege: number;
  /** Assumed annual college-cost inflation, as a percentage. */
  costInflationPct: number;
  /** Amount already saved toward college. */
  currentSavings: number;
  /** Assumed annual return on savings, as a percentage (the user's assumption). */
  expectedReturnPct: number;
}

export interface CollegeCostResult {
  /** Total projected cost: each enrollment year's cost inflated to that year. */
  projectedTotalCost: Money;
  /** Level monthly contribution to fully fund the cost by the start date. */
  monthlyContribution: Money;
  /** What today's savings alone grow to by the start date. */
  projectedFromCurrent: Money;
  /** True when today's savings already cover the projected cost. */
  alreadyOnTrack: boolean;
}

/**
 * College cost planner (BUILD-SPEC-2 §6.7). Projects each enrollment year's cost
 * forward at an assumed college-inflation rate, sums them, and solves for the
 * level monthly contribution to have it fully saved by the start date (counting
 * what's already saved, growing at an assumed return). Targeting the full amount
 * by freshman year is a deliberately conservative simplification — you actually
 * draw it down over the college years. All rates are the user's assumptions.
 */
export function collegeCostPlan(input: CollegeCostInput): CollegeCostResult {
  const yearsUntilStart = Math.max(0, Math.round(input.yearsUntilStart));
  const yearsOfCollege = Math.max(0, Math.round(input.yearsOfCollege));
  const inflationFactor = new Decimal(input.costInflationPct).div(100).plus(1);
  const costToday = new Decimal(Math.max(0, input.annualCostToday));

  let total = new Decimal(0);
  for (let j = 0; j < yearsOfCollege; j++) {
    total = total.plus(costToday.times(inflationFactor.pow(yearsUntilStart + j)));
  }
  const projectedTotalCost = Money.from(total);

  const funding = requiredMonthlyContribution({
    currentSaved: Math.max(0, input.currentSavings),
    target: projectedTotalCost.toNumber(),
    months: yearsUntilStart * 12,
    annualReturnPct: input.expectedReturnPct,
  });

  return {
    projectedTotalCost,
    monthlyContribution: funding.monthlyContribution,
    projectedFromCurrent: funding.projectedFromCurrent,
    alreadyOnTrack: funding.alreadyOnTrack,
  };
}

/** Pay a balance off month by month through an intro rate then a post-intro rate. */
function simulatePhasedPayoff(
  startBalance: number,
  introRatePct: number,
  introMonths: number,
  postRatePct: number,
  monthlyPayment: number,
): { months: number; interest: Money } | null {
  let bal = Money.from(Math.max(0, startBalance));
  if (!bal.greaterThan(0)) return { months: 0, interest: Money.zero() };
  const pay = Money.from(Math.max(0, monthlyPayment));
  let interestTotal = Money.zero();
  let months = 0;
  const MAX_MONTHS = 1200;

  while (bal.greaterThan(0) && months < MAX_MONTHS) {
    const ratePct = months < Math.max(0, introMonths) ? introRatePct : postRatePct;
    const monthlyRate = new Decimal(ratePct).div(100).div(12);
    const interest = bal.multiply(monthlyRate);
    // A payment that can't cover the interest never retires the balance.
    if (interest.greaterThan(0) && pay.lessThanOrEqual(interest)) return null;
    const owed = bal.add(interest);
    const thisPay = pay.greaterThan(owed) ? owed : pay;
    if (!thisPay.greaterThan(0)) return null; // no payment → never pays off
    bal = owed.subtract(thisPay);
    interestTotal = interestTotal.add(interest);
    months += 1;
  }
  if (bal.greaterThan(0)) return null;
  return { months, interest: interestTotal };
}

export interface BalanceTransferInput {
  /** Current balance owed. */
  balance: number;
  /** Current card's APR, as a percentage. */
  currentAprPct: number;
  /** Fixed amount paid each month on either path. */
  monthlyPayment: number;
  /** Balance-transfer fee, as a percentage of the transferred balance. */
  transferFeePct: number;
  /** Promotional APR during the intro period (often 0), as a percentage. */
  introAprPct: number;
  /** Length of the intro period in months. */
  introMonths: number;
  /** APR after the intro period ends, as a percentage. */
  postIntroAprPct: number;
}

export interface BalanceTransferResult {
  /** Months to clear the current card (null if the payment can't cover interest). */
  currentMonths: number | null;
  /** Interest paid keeping the current card (null if it never pays off). */
  currentInterest: Money | null;
  /** The upfront transfer fee. */
  transferFee: Money;
  /** Months to clear the transferred balance (null if it never pays off). */
  transferMonths: number | null;
  /** Interest paid on the transfer path, excluding the fee (null if never). */
  transferInterest: Money | null;
  /** Transfer interest plus the fee (null if it never pays off). */
  transferTotalCost: Money | null;
  /** Current interest minus the transfer's total cost (positive = transferring saves). */
  interestSaved: Money | null;
  /** True when the transferred balance is cleared before the intro rate ends. */
  paysOffWithinIntro: boolean;
}

/**
 * Balance-transfer / consolidation break-even (BUILD-SPEC-2 §6.2). Compares
 * keeping the current card against transferring the balance (paying a fee, then
 * an intro APR for a promo window, then a post-intro APR), both at the same
 * monthly payment. Deterministic from the fees and rates the user enters.
 */
export function balanceTransferBreakEven(input: BalanceTransferInput): BalanceTransferResult {
  const current = debtPayoff(input.balance, input.currentAprPct, input.monthlyPayment);
  const transferFee = Money.from(Math.max(0, input.balance)).multiply(
    Math.max(0, input.transferFeePct) / 100,
  );
  const startBalance = Money.from(Math.max(0, input.balance)).add(transferFee);
  const transfer = simulatePhasedPayoff(
    startBalance.toNumber(),
    input.introAprPct,
    input.introMonths,
    input.postIntroAprPct,
    input.monthlyPayment,
  );

  const transferInterest = transfer ? transfer.interest : null;
  const transferTotalCost = transferInterest ? transferInterest.add(transferFee) : null;
  const currentInterest = current ? current.totalInterest : null;
  const interestSaved =
    currentInterest && transferTotalCost ? currentInterest.subtract(transferTotalCost) : null;

  return {
    currentMonths: current ? current.months : null,
    currentInterest,
    transferFee,
    transferMonths: transfer ? transfer.months : null,
    transferInterest,
    transferTotalCost,
    interestSaved,
    paysOffWithinIntro: transfer ? transfer.months <= Math.max(0, input.introMonths) : false,
  };
}
