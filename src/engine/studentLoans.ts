/**
 * Federal student loan payments after Pub. L. 119-21 (SPEC-5 Phase 33).
 *
 * Three plans, each the formula its statute writes, simulated month by month
 * from the balance so the total paid and the end date follow from the rules
 * rather than from an average:
 *
 * - the Repayment Assistance Plan (20 U.S.C. §1087e(q)): a share of all AGI
 *   by tier, less $50 a month per dependent, never under $10; unpaid interest
 *   is not charged after an on-time payment, principal falls by at least the
 *   lesser of $50 or the payment, and what is left after 360 payments is
 *   cancelled;
 * - the Tiered Standard plan (§1087e(d)(7)): a fixed payment over a term set
 *   by the principal;
 * - legacy income-based repayment (§1098e): 15% (10% for a new borrower) of
 *   AGI above 150% of the poverty line, no more than the 10-year standard
 *   payment, cancelled after 25 (20) years.
 *
 * Income grows at a stated assumption, once a year, because an income-driven
 * payment is recertified annually. Nothing here picks a plan.
 */
import { monthlyMortgagePayment } from "./finance";
import { povertyLine } from "./benefits";
import type { FederalPovertyLevelData, StudentLoansData } from "../data/schemas";

export interface LoanSituation {
  balance: number;
  /** Weighted average interest rate, percent. */
  ratePct: number;
  agi: number;
  dependents: number;
  /** For the poverty line income-based repayment subtracts. */
  familySize: number;
  /** Yearly income growth, as a fraction (0.02 = 2%). */
  incomeGrowth: number;
  /** Borrowed nothing before July 1, 2014 (a "new borrower" for §1098e(e)). */
  newBorrower2014: boolean;
}

export interface PlanOutcome {
  plan: "rap" | "standard" | "ibr";
  /** The payment in the first month. */
  monthlyNow: number;
  totalPaid: number;
  months: number;
  /** Cancelled at the end of the plan's term; zero when paid off. */
  forgiven: number;
}

/** RAP's monthly payment at an AGI (§1087e(q)(4)(B)). */
export function rapMonthly(agi: number, dependents: number, rules: StudentLoansData): number {
  const r = rules.rap;
  const income = Math.max(0, agi);
  let base = r.floorAnnualPayment;
  for (const t of r.tiers) if (income > t.over) base = (income * t.pct) / 100;
  const monthly = base / 12 - r.dependentReductionMonthly * Math.max(0, Math.floor(dependents));
  return Math.round(Math.max(r.minimumMonthly, monthly) * 100) / 100;
}

/** The Tiered Standard plan's term for a principal (§1087e(d)(7)(A)(i)(II)). */
export function standardYears(principal: number, rules: StudentLoansData): number {
  for (const t of rules.standard.terms)
    if (t.principalBelow === null || principal < t.principalBelow) return t.years;
  return rules.standard.terms[rules.standard.terms.length - 1]!.years;
}

interface Simulation {
  payment: (yearIndex: number) => number;
  maxMonths: number;
  waiveUnpaidInterest: boolean;
  principalMatch: number;
}

function simulate(s: LoanSituation, plan: PlanOutcome["plan"], sim: Simulation): PlanOutcome {
  const r = Math.max(0, s.ratePct) / 100 / 12;
  let principal = Math.max(0, s.balance);
  let unpaidInterest = 0;
  let totalPaid = 0;
  let months = 0;
  const monthlyNow = Math.min(sim.payment(0), principal * (1 + r));
  while (principal + unpaidInterest > 0.005 && months < sim.maxMonths) {
    const interest = principal * r + unpaidInterest;
    const owed = principal + interest;
    const pay = Math.min(sim.payment(Math.floor(months / 12)), owed);
    totalPaid += pay;
    let toPrincipal = 0;
    // Strict on purpose: a payment exactly equal to the interest takes either
    // branch to the same place (nothing to principal, nothing left unpaid), so
    // `>=` would be a boundary no case could ever hold.
    if (pay > interest) {
      toPrincipal = pay - interest;
      unpaidInterest = 0;
    } else {
      // §1087e(q)(2)(A) waives what the payment did not cover; elsewhere it
      // accrues, uncapitalized, as §1098e leaves it.
      unpaidInterest = sim.waiveUnpaidInterest ? 0 : interest - pay;
    }
    // §1087e(q)(2)(B): principal falls by at least the lesser of $50 or the
    // payment.
    const match =
      sim.principalMatch > 0 && toPrincipal < sim.principalMatch
        ? Math.min(sim.principalMatch, pay) - toPrincipal
        : 0;
    principal = Math.max(0, principal - toPrincipal - match);
    months += 1;
  }
  return {
    plan,
    monthlyNow: Math.round(monthlyNow * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    months,
    forgiven: Math.round((principal + unpaidInterest) * 100) / 100,
  };
}

const agiInYear = (s: LoanSituation, year: number): number =>
  Math.max(0, s.agi) * Math.pow(1 + s.incomeGrowth, year);

export function rapOutcome(s: LoanSituation, rules: StudentLoansData): PlanOutcome {
  return simulate(s, "rap", {
    payment: (y) => rapMonthly(agiInYear(s, y), s.dependents, rules),
    maxMonths: rules.rap.qualifyingPayments,
    waiveUnpaidInterest: true,
    principalMatch: rules.rap.principalMatchMonthly,
  });
}

export function standardOutcome(s: LoanSituation, rules: StudentLoansData): PlanOutcome {
  const years = standardYears(s.balance, rules);
  const payment = monthlyMortgagePayment(s.balance, s.ratePct, years).roundToCents().toNumber();
  return simulate(s, "standard", {
    payment: () => payment,
    maxMonths: years * 12 + 1,
    waiveUnpaidInterest: false,
    principalMatch: 0,
  });
}

export function ibrMonthly(
  agi: number,
  familySize: number,
  newBorrower2014: boolean,
  balance: number,
  ratePct: number,
  rules: StudentLoansData,
  fpl: FederalPovertyLevelData,
): number {
  const i = rules.ibr;
  const line = povertyLine(familySize, fpl).toNumber() * i.povertyMultiple;
  const pct = newBorrower2014 ? i.newBorrowerPct : i.pct;
  const income = (Math.max(0, agi - line) * pct) / 100 / 12;
  const cap = monthlyMortgagePayment(balance, ratePct, i.capYears).toNumber();
  return Math.round(Math.min(income, cap) * 100) / 100;
}

export function ibrOutcome(
  s: LoanSituation,
  rules: StudentLoansData,
  fpl: FederalPovertyLevelData,
): PlanOutcome {
  const years = s.newBorrower2014 ? rules.ibr.newBorrowerYears : rules.ibr.years;
  return simulate(s, "ibr", {
    payment: (y) =>
      ibrMonthly(
        agiInYear(s, y),
        s.familySize,
        s.newBorrower2014,
        s.balance,
        s.ratePct,
        rules,
        fpl,
      ),
    maxMonths: years * 12,
    waiveUnpaidInterest: false,
    principalMatch: 0,
  });
}

/** §221's deduction for a year's interest, after the phase-out (Rev. Proc. 2025-32 §.29). */
export function interestDeduction(
  interestPaid: number,
  magi: number,
  joint: boolean,
  rules: StudentLoansData,
): number {
  const d = rules.interestDeduction;
  const [from, to] = joint ? d.phaseOut.joint : d.phaseOut.other;
  const capped = Math.min(Math.max(0, interestPaid), d.max);
  // Strict at both ends: the phase-out is continuous, so at exactly `from` it
  // gives the whole deduction and at exactly `to` it gives none, the same
  // answers these early returns give.
  if (magi < from) return capped;
  if (magi > to) return 0;
  return Math.round(capped * (1 - (magi - from) / (to - from)) * 100) / 100;
}
