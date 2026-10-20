/**
 * The child and dependent care credit and the dependent care FSA (SPEC-5
 * young-family F1), as rewritten for 2026 by Pub. L. 119-21.
 *
 * Two routes for the same care bill. The credit is the applicable percentage
 * of capped expenses (§21), limited by the federal income tax it offsets
 * (§26(a)), so it is never refundable. The FSA excludes up to its limit from
 * wages (§129), which saves income tax and, because §3121(a)(18) keeps it out
 * of FICA wages too, Social Security and Medicare tax; the tax engine prices
 * that by running the return with and without it. What the FSA excludes comes
 * off the credit's cap, so the FSA route keeps only what the cap has left.
 */
import { Money } from "./money";
import { evaluateTaxes, type TaxContext } from "./tax";
import type { DependentCareData, FilingStatus } from "../data/schemas";

export interface DependentCareInput {
  filingStatus: FilingStatus;
  /** The household's wages: both spouses' on a joint return. */
  wages: number;
  /** On a joint return, the lower-earning spouse's wages (§21(d)(1)(B)). */
  lowerEarnerWages: number;
  /** A spouse who is a full-time student or unable to care for themselves (§21(d)(2)). */
  spouseDeemedEarner: boolean;
  /** Children under 13, or others who qualify. */
  qualifyingIndividuals: number;
  /** A year's work-related care expenses. */
  expenses: number;
}

export interface CreditFigures {
  /** Expenses the credit counts, after the cap and the earned-income limit. */
  creditable: Money;
  /** Whole percent, §21(a)(2). */
  percentage: number;
  /** The credit before the tax limit. */
  tentative: Money;
  /** The federal income tax the credit can offset. */
  liability: Money;
  credit: Money;
}

export interface DependentCareResult {
  /** §21(e)(2): a married couple filing separately gets no credit. */
  creditAllowed: boolean;
  creditOnly: CreditFigures;
  fsa: {
    excluded: Money;
    /** Income tax and FICA saved by excluding it, from the tax engine. */
    taxSaving: Money;
    /** Of which, Social Security and Medicare tax. */
    ficaSaving: Money;
    /** The credit on what the cap has left. */
    credit: CreditFigures;
    total: Money;
  };
  /** The route worth more; the FSA on a tie, since it also lowers FICA. */
  better: "credit" | "fsa";
}

/** §21(a)(2)'s applicable percentage at an adjusted gross income. */
export function applicablePercentage(
  agi: number,
  joint: boolean,
  rules: DependentCareData,
): number {
  const a = rules.applicablePercentage;
  let pct = a.start;
  const overFirst = agi - a.firstThreshold;
  if (overFirst > 0) pct = Math.max(a.firstFloor, pct - Math.ceil(overFirst / a.firstStep));
  const second = joint ? a.secondThreshold.joint : a.secondThreshold.other;
  const step = joint ? a.secondStep.joint : a.secondStep.other;
  const overSecond = agi - second;
  if (overSecond > 0) pct = Math.max(a.secondFloor, pct - Math.ceil(overSecond / step));
  return pct;
}

function creditFigures(
  countable: number,
  agi: number,
  joint: boolean,
  liability: Money,
  rules: DependentCareData,
): CreditFigures {
  const percentage = applicablePercentage(agi, joint, rules);
  const creditable = Money.from(Math.max(0, countable));
  const tentative = creditable.multiply(percentage).divide(100).roundToCents();
  return {
    creditable,
    percentage,
    tentative,
    liability,
    credit: tentative.greaterThan(liability) ? liability : tentative,
  };
}

export function compareDependentCare(
  input: DependentCareInput,
  ctx: TaxContext,
  rules: DependentCareData,
): DependentCareResult {
  const joint = input.filingStatus === "married_jointly";
  const separate = input.filingStatus === "married_separately";
  const several = input.qualifyingIndividuals >= 2;
  const wages = Math.max(0, input.wages);
  const expenses = Math.max(0, input.expenses);
  const cap = several ? rules.expenseCap.twoOrMore : rules.expenseCap.one;
  const deemed =
    12 *
    (several ? rules.deemedMonthlyEarnedIncome.twoOrMore : rules.deemedMonthlyEarnedIncome.one);
  const lower = Math.max(0, input.lowerEarnerWages);
  // §21(d) and §129(b): no more than the lower earner's earnings.
  const earnedLimit = joint
    ? Math.min(wages, input.spouseDeemedEarner ? Math.max(lower, deemed) : lower)
    : wages;
  const fsaLimit = separate ? rules.fsaExclusionLimit.separate : rules.fsaExclusionLimit.other;

  const base = evaluateTaxes({ filingStatus: input.filingStatus, wages }, ctx);
  const creditOnly = creditFigures(
    separate ? 0 : Math.min(expenses, cap, earnedLimit),
    base.agi.toNumber(),
    joint,
    base.federal.incomeTax,
    rules,
  );

  const excluded = Math.min(expenses, fsaLimit, earnedLimit);
  const withFsa = evaluateTaxes({ filingStatus: input.filingStatus, wages: wages - excluded }, ctx);
  const left = Math.min(expenses - excluded, cap - excluded, earnedLimit - excluded);
  const fsaCredit = creditFigures(
    separate ? 0 : left,
    withFsa.agi.toNumber(),
    joint,
    withFsa.federal.incomeTax,
    rules,
  );
  const taxSaving = base.totals.totalTax.subtract(withFsa.totals.totalTax);
  const total = taxSaving.add(fsaCredit.credit);
  return {
    creditAllowed: !separate,
    creditOnly,
    fsa: {
      excluded: Money.from(excluded),
      taxSaving,
      ficaSaving: base.fica.total.subtract(withFsa.fica.total),
      credit: fsaCredit,
      total,
    },
    better: creditOnly.credit.greaterThan(total) ? "credit" : "fsa",
  };
}
