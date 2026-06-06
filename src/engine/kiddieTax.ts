/**
 * Kiddie-tax estimator (SPEC-3 §4.5, IRC §1(g), Form 8615). A dependent child's
 * investment (unearned) income is taxed in three bands: the dependent standard
 * deduction shelters the first slice, the next like-sized slice is taxed at the
 * child's own (low) rate, and everything above twice the base is taxed at the
 * parents' marginal rate — the anti-arbitrage rule that stops income-shifting to a
 * child's bracket.
 *
 * Pure function of the inputs, the cited kiddie-tax shard (the $1,350 base and the
 * $450 earned-income add-on), and the federal single schedule (brackets + standard
 * deduction) the caller supplies. The child's-rate band is computed on the single
 * brackets from $0; the parents'-rate band applies their supplied marginal rate.
 * This is an estimate — the exact Form 8615 interaction with the parents' return
 * has edge cases — so the tile frames it as one and points to a pro.
 */
import { Money } from "./money";
import { bracketTax, type Bracket } from "./tax";

export interface KiddieTaxInput {
  /** The child's investment / unearned income (interest, dividends, gains). */
  unearnedIncome: number;
  /** The child's earned income (wages) — always taxed at the child's own rate. */
  earnedIncome: number;
  /** The parents' top marginal ordinary rate (0.10–0.37). */
  parentMarginalRate: number;
}

export interface KiddieTaxResult {
  /** The dependent standard deduction: max(base, earned + add-on), capped. */
  dependentStandardDeduction: Money;
  /** Taxable income after the deduction. */
  taxableIncome: Money;
  /** The slice taxed at the parents' marginal rate (net unearned income). */
  amountAtParentRate: Money;
  /** The slice taxed at the child's own rate (earned income + the middle band). */
  amountAtChildRate: Money;
  taxAtParentRate: Money;
  taxAtChildRate: Money;
  totalTax: Money;
  /** Effective rate on the unearned income (0 when there is none). */
  effectiveRateOnUnearned: number;
  /** True once unearned income clears twice the base (the kiddie-tax trigger). */
  subjectToKiddieTax: boolean;
}

export function kiddieTax(
  input: KiddieTaxInput,
  data: { dependentStandardDeductionBase: number; earnedIncomeAddOn: number },
  federal: { singleBrackets: Bracket[]; singleStandardDeduction: number },
): KiddieTaxResult {
  const unearned = Math.max(0, input.unearnedIncome);
  const earned = Math.max(0, input.earnedIncome);
  const base = data.dependentStandardDeductionBase;

  // Dependent standard deduction: greater of the base or earned + add-on, but
  // never more than the single standard deduction.
  const stdNum = Math.min(
    federal.singleStandardDeduction,
    Math.max(base, earned + data.earnedIncomeAddOn),
  );
  const taxableNum = Math.max(0, unearned + earned - stdNum);

  // Net unearned income (taxed at the parents' rate): unearned over twice the
  // base, capped at taxable income.
  const parentThreshold = 2 * base;
  const netUnearned = Math.max(0, unearned - parentThreshold);
  const atParentNum = Math.min(netUnearned, taxableNum);
  const atChildNum = taxableNum - atParentNum;

  const taxAtParentRate = Money.from(atParentNum).multiply(input.parentMarginalRate);
  const taxAtChildRate = bracketTax(Money.from(atChildNum), federal.singleBrackets);
  const totalTax = taxAtParentRate.add(taxAtChildRate);

  return {
    dependentStandardDeduction: Money.from(stdNum),
    taxableIncome: Money.from(taxableNum),
    amountAtParentRate: Money.from(atParentNum),
    amountAtChildRate: Money.from(atChildNum),
    taxAtParentRate,
    taxAtChildRate,
    totalTax,
    effectiveRateOnUnearned: unearned > 0 ? totalTax.toNumber() / unearned : 0,
    subjectToKiddieTax: netUnearned > 0,
  };
}
