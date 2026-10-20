/**
 * An estimate of the federal SSI payment (SPEC-5 later-life L6).
 *
 * Countable income follows the order the regulations set: the $20 general
 * exclusion from unearned income first (20 CFR §416.1124(c)(12)), any unused
 * part of it then from earned income; from earned income, the student
 * exclusion for someone under 22, then $65, then half of the rest
 * (§416.1112(c)). The payment is the federal benefit rate less that.
 */
import Decimal from "decimal.js";
import { Money } from "./money";
import type { SsiData } from "../data/schemas";

export interface SsiInput {
  couple: boolean;
  /** A month's earnings from work. */
  earned: number;
  /** A month's other income: Social Security, a pension, and so on. */
  unearned: number;
  /** A student under 22, for the student earned-income exclusion. */
  student: boolean;
  resources: number;
}

export interface SsiResult {
  countableUnearned: Money;
  countableEarned: Money;
  countable: Money;
  federalBenefitRate: Money;
  payment: Money;
  overResourceLimit: boolean;
  resourceLimit: number;
}

export function ssiEstimate(input: SsiInput, rules: SsiData): SsiResult {
  const unearned = new Decimal(Math.max(0, input.unearned));
  const earned = new Decimal(Math.max(0, input.earned));
  const general = new Decimal(rules.generalExclusion);
  const countableUnearned = Decimal.max(0, unearned.minus(general));
  const unusedGeneral = Decimal.max(0, general.minus(unearned));
  const afterStudent = input.student
    ? Decimal.max(0, earned.minus(rules.studentExclusion.monthly))
    : earned;
  const countableEarned = Decimal.max(
    0,
    afterStudent.minus(unusedGeneral).minus(rules.earnedExclusion),
  ).times(rules.earnedShareCounted);
  const countable = countableUnearned.plus(countableEarned);
  const rate = new Decimal(
    input.couple ? rules.federalBenefitRate.couple : rules.federalBenefitRate.individual,
  );
  const limit = input.couple ? rules.resourceLimit.couple : rules.resourceLimit.individual;
  return {
    countableUnearned: Money.from(countableUnearned).roundToCents(),
    countableEarned: Money.from(countableEarned).roundToCents(),
    countable: Money.from(countable).roundToCents(),
    federalBenefitRate: Money.from(rate),
    payment: Money.from(Decimal.max(0, rate.minus(countable))).roundToCents(),
    overResourceLimit: Math.max(0, input.resources) > limit,
    resourceLimit: limit,
  };
}
