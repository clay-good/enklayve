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
