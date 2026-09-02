import { Money } from "../money";
import type {
  FilingStatus,
  ItemizedLimitationData,
  NonItemizerCharitableData,
  SaltLimitationData,
  SeniorDeductionData,
  SteppedIncomeDeductionData,
} from "../../data/schemas";
import type { DeductionMode, DeductionResult, ItemizedInput } from "./types";

/**
 * The federal SALT cap for one filer, IRC §164(b)(6) and (b)(7).
 *
 * This used to be `SALT_CAP = 10000`, a constant with no citation and nothing
 * watching it. The One Big Beautiful Bill Act replaced the flat $10,000 with an
 * "applicable limitation amount" that is $40,400 for 2026, phases down by 30% of
 * modified AGI over $505,000, never falls below $10,000, and is halved for a
 * married individual filing separately. The federal shard had already been
 * refreshed for that Act; the constant beside it had not, so anyone itemizing
 * more than $10,000 of state and local tax — which in a high-tax state is most
 * people who itemize at all — was shown a deduction up to $30,400 too small and
 * a federal tax bill to match.
 *
 * MAGI here is AGI. §164(b)(7)(B)(iv) defines it as AGI increased by amounts
 * excluded under §911, §931 or §933 — foreign earned income and the territorial
 * exclusions — none of which this engine models, so for every input it accepts
 * the two are equal. Named `magi` anyway, because the day one of those is
 * modelled the call site should not have to be found by reading.
 */
export function saltCapFor(
  limitation: SaltLimitationData | undefined,
  status: FilingStatus,
  magi: Money,
): number {
  // Unreachable with a valid federal shard: JurisdictionSchema requires the
  // limitation on US, so a shard without one is marked invalid by the loader and
  // the tile shows its verify-before-relying banner rather than reaching here.
  // Uncapped rather than a plausible number, so that if it ever IS reached the
  // failure is visible in the answer instead of hiding inside it.
  if (!limitation) return Number.POSITIVE_INFINITY;

  const share = status === "married_separately" ? limitation.marriedSeparatelyShare : 1;
  const threshold = limitation.thresholdAmount * share;
  const over = Math.max(0, magi.toNumber() - threshold);
  const reduced = limitation.applicableLimitationAmount - limitation.phasedownRate * over;
  // §164(b)(7)(B)(iii) floors the applicable limitation amount, and §164(b)(6)(B)
  // halves it afterwards — so a separate filer's floor is half the floor, not
  // the floor. Reading the two sentences in the other order gives a filer above
  // the threshold twice the cap the statute allows.
  return Math.max(limitation.floor, reduced) * share;
}
/** Medical expenses are deductible only above 7.5% of AGI. */
export const MEDICAL_AGI_FLOOR_RATE = 0.075;

/**
 * Total federal itemized deduction from the "big four" (BUILD-SPEC.md §3.2):
 * SALT (capped), mortgage interest, charitable contributions above the §170(b)(1)(I)
 * floor, and medical expenses above the AGI floor. The percentage CEILINGS on
 * giving (60% of the contribution base for cash to a public charity, 30% for
 * appreciated property) remain out of scope: they bind a filer giving a large
 * share of their income, and this engine's single `charitable` input cannot tell
 * the two kinds apart to apply them.
 */
export function itemizedTotal(
  itemized: ItemizedInput,
  agi: Money,
  saltCap: number,
  charitableFloorRate = 0,
): Money {
  const salt = Money.from(Math.min(itemized.stateAndLocalTaxes ?? 0, saltCap));
  const mortgage = Money.from(itemized.mortgageInterest ?? 0);
  // §170(b)(1)(I), new for 2026: giving is allowed "only to the extent that the
  // aggregate of such contributions exceeds 0.5 percent of the taxpayer's
  // contribution base". The base is AGI without a net operating loss carryback
  // (§170(b)(1)(H)); for a wage earner that is the AGI already computed here.
  // The rate is zero for a tax year whose shard carries no floor, which is every
  // year before this one.
  const charitableFloor = agi.isNegative()
    ? Money.zero()
    : agi.multiply(Math.max(0, charitableFloorRate));
  const charitableRaw = Money.from(itemized.charitable ?? 0);
  const charitable = charitableRaw.greaterThan(charitableFloor)
    ? charitableRaw.subtract(charitableFloor)
    : Money.zero();

  // 7.5% of AGI, but never negative: a non-positive AGI yields a $0 floor, so
  // the whole expense is deductible and the deduction never exceeds the actual
  // expense. (Through evaluateTaxes the AGI is already clamped at zero; this
  // keeps itemizedTotal correct if called directly with a negative AGI — the
  // large-adjustments corner in SPEC-3-hardening §D.)
  const medicalFloor = agi.isNegative() ? Money.zero() : agi.multiply(MEDICAL_AGI_FLOOR_RATE);
  const medicalRaw = Money.from(itemized.medicalExpenses ?? 0);
  const medical = medicalRaw.greaterThan(medicalFloor)
    ? medicalRaw.subtract(medicalFloor)
    : Money.zero();

  return salt.add(mortgage).add(charitable).add(medical);
}

/**
 * IRC §68: the cap on what an itemized deduction is WORTH.
 *
 * Rewritten by the One Big Beautiful Bill Act and biting again in 2026 for the
 * first time since 2017 — the old version, a phase-out of the deductions
 * themselves, was switched off for every year from 2018 through 2025.
 *
 * The new one reduces the deduction by "2/37 of the lesser of (1) such amount of
 * itemized deductions, or (2) so much of the taxable income of the taxpayer for
 * the taxable year (determined without regard to this section and increased by
 * such amount of itemized deductions) as exceeds the dollar amount at which the
 * 37 percent rate bracket under section 1 begins".
 *
 * Two thirty-sevenths of thirty-seven percent is two percent, which is the whole
 * design: a dollar of deduction saves a top-bracket filer 35 cents instead of
 * 37. The two arms of the `lesser of` are what makes it a cap on value rather
 * than a haircut — a filer only just inside the 37% bracket has little income up
 * there for the deduction to be worth 37 cents against, so only that much is
 * reduced.
 *
 * `incomeAboveDeductions` is clause (2)'s subject: taxable income computed
 * without this section and then increased by the deductions again, which is the
 * income left after everything §63(b) subtracts OTHER than the itemized total.
 *
 * §68(b) says this is applied "after the application of any other limitation on
 * the allowance of any itemized deduction", so it is the last thing to touch the
 * figure — after the SALT cap, the §170(b)(1)(I) charitable floor, and the
 * medical floor.
 */
export function itemizedLimitationFor(
  rule: ItemizedLimitationData | undefined,
  bracketThreshold: number | undefined,
  itemizedAmount: Money,
  incomeAboveDeductions: Money,
): Money {
  if (!rule || bracketThreshold === undefined) return Money.zero();
  const over = incomeAboveDeductions.subtract(bracketThreshold);
  if (!over.greaterThan(0) || !itemizedAmount.greaterThan(0)) return Money.zero();
  const lesser = over.lessThan(itemizedAmount) ? over : itemizedAmount;
  return lesser.multiply(rule.reductionNumerator).divide(rule.reductionDenominator);
}

/**
 * IRC §170(p): what a filer who does not itemize may deduct for cash giving.
 *
 * Capped at $1,000, or $2,000 "in the case of a joint return" — the statute's
 * own words, which is why only `married_jointly` gets the larger cap. A
 * qualifying surviving spouse files at joint RATES but does not file a joint
 * return, so they get the single cap here; that reading is conservative, and it
 * is the reading the words support.
 *
 * The engine's `charitable` input does not distinguish cash from property, nor
 * a §170(b)(1)(A) charity from a donor-advised fund, and §170(p) counts only the
 * first of each. So this is an upper bound on the deduction for a filer whose
 * giving was not all qualifying cash, which the tile says out loud.
 */
export function nonItemizerCharitableFor(
  rule: NonItemizerCharitableData | undefined,
  status: FilingStatus,
  itemized: ItemizedInput,
): Money {
  if (!rule) return Money.zero();
  const cap = status === "married_jointly" ? rule.capJointReturn : rule.cap;
  return Money.from(Math.min(Math.max(0, itemized.charitable ?? 0), cap));
}

/**
 * Choose the federal deduction. "auto" (the default) takes the larger of the
 * standard deduction and the itemized total — the choice a rational filer makes.
 *
 * Since 2026 that comparison is not between two numbers but between two
 * packages: itemizing forfeits §170(p), so the standard side is worth the
 * standard deduction PLUS the cash giving §170(p) allows. A filer with $30,000
 * of itemized deductions against a $32,200 standard deduction and $2,000 of
 * giving should take the standard, and would have been told to itemize by a
 * comparison that left §170(p) out of the sum it was choosing between.
 */
export function chooseFederalDeduction(
  mode: DeductionMode,
  standardDeduction: Money,
  itemized: ItemizedInput,
  agi: Money,
  saltCap: number,
  nonItemizedCharitable: Money = Money.zero(),
  charitableFloorRate = 0,
): DeductionResult {
  const itemizedAmount = itemizedTotal(itemized, agi, saltCap, charitableFloorRate);
  // `senior` is filled in by the caller: §151(d)(5)(C) does not depend on this
  // choice, so it has no business influencing it.
  const takeStandard = (): DeductionResult => ({
    kind: "standard",
    amount: standardDeduction,
    nonItemizedCharitable,
    senior: Money.zero(),
    qualifiedTips: Money.zero(),
    qualifiedOvertime: Money.zero(),
    vehicleLoanInterest: Money.zero(),
  });
  const takeItemized = (): DeductionResult => ({
    kind: "itemized",
    amount: itemizedAmount,
    nonItemizedCharitable: Money.zero(),
    senior: Money.zero(),
    qualifiedTips: Money.zero(),
    qualifiedOvertime: Money.zero(),
    vehicleLoanInterest: Money.zero(),
  });
  if (mode === "standard") return takeStandard();
  if (mode === "itemized") return takeItemized();
  return itemizedAmount.greaterThan(standardDeduction.add(nonItemizedCharitable))
    ? takeItemized()
    : takeStandard();
}

/**
 * IRC §151(d)(5)(C): the deduction for filers aged 65 and over.
 *
 * `seniorsAge65Plus` is how many of the people on the return had turned 65 by
 * the close of the year — the taxpayer, and on a joint return the spouse. A
 * count rather than an age, because a count is what the statute needs and it is
 * the smaller thing to ask a reader for.
 *
 * Three readings worth stating, each held by a test:
 *
 *   - §151(d)(5)(C)(v): a married filer gets this ONLY on a joint return, so
 *     married filing separately is zero rather than half.
 *   - §151(d)(5)(C)(iii)(I) reduces "the $6,000 amount in clause (i)", which is
 *     per individual — so a couple both over 65 lose twelve cents of deduction
 *     per dollar of income over the threshold, not six.
 *   - a qualifying surviving spouse files at joint rates and does not file a
 *     joint return, so clause (ii)(II) does not reach their late spouse: one
 *     individual, and the single threshold.
 *
 * Unlike §170(p) this is not conditioned on taking the standard deduction.
 * §63(a) subtracts every allowable deduction other than the standard one for a
 * filer who itemizes, and §63(b)(2) names §151 for one who does not, so it
 * applies either way.
 */
export function seniorDeductionFor(
  rule: SeniorDeductionData | undefined,
  status: FilingStatus,
  seniorsAge65Plus: number,
  magi: Money,
): Money {
  if (!rule) return Money.zero();
  if (status === "married_separately") return Money.zero();
  const joint = status === "married_jointly";
  const qualifying = Math.min(Math.max(0, Math.floor(seniorsAge65Plus)), joint ? 2 : 1);
  if (qualifying === 0) return Money.zero();
  const threshold = joint ? rule.thresholdJointReturn : rule.thresholdSingle;
  const over = Math.max(0, magi.toNumber() - threshold);
  const perPerson = Math.max(0, rule.perQualifiedIndividual - rule.phaseOutRate * over);
  return Money.from(perPerson * qualifying);
}

/**
 * IRC §224 (qualified tips), §225 (qualified overtime), and §163(h)(4)
 * (qualified passenger vehicle loan interest).
 *
 * One function for three sections, because the statutes are the same shape: a
 * cap, a step-down of a fixed number of dollars for each $1,000 of modified AGI
 * over a threshold, and an amount the reader has to characterise for us.
 *
 * The step is the part worth being careful about, and it is not the same step
 * twice. "$100 for each $1,000 by which ... exceeds $150,000" counts COMPLETED
 * thousands — neither §224 nor §225 says "or fraction thereof", which §24(b)(2)
 * does say about the child credit twelve hundred lines away in the same engine.
 * So a tips filer $1,999 over the threshold loses $100 and not $200.
 * §163(h)(4)(C)(ii) says "$200 for each $1,000 (or portion thereof)", so the
 * same filer $1,001 over loses the whole second $200. Whether a part-step counts
 * is `partialStepCounts` on the rule, read from the shard rather than assumed,
 * because the two readings are one clause apart and produce different tax.
 *
 * Who may claim it splits the same way. §224(f) and §225(e) deny the deduction
 * to a married individual except on a joint return; §163(h)(4) says nothing of
 * the kind, so a separate filer gets it at the single threshold. That is
 * `jointReturnOnly`.
 *
 * `amount` is what the reader says was qualified tips, qualified overtime, or
 * qualified vehicle loan interest. The engine cannot check any of it: §224(d)
 * counts only cash tips in an occupation that customarily received them before
 * 2025, as the Secretary lists; §225 only the premium half of FLSA-required
 * overtime; §163(h)(4)(B) and (D) only interest on a first-lien loan taken out
 * after 2024 for a new, personally used vehicle assembled in the United States,
 * with its VIN on the return. The tiles say so; this computes the ceiling that
 * follows from the number it is given.
 */
export function steppedIncomeDeductionFor(
  rule: SteppedIncomeDeductionData | undefined,
  status: FilingStatus,
  amount: number,
  magi: Money,
): Money {
  if (!rule) return Money.zero();
  if (rule.jointReturnOnly && status === "married_separately") return Money.zero();
  const joint = status === "married_jointly";
  const capped = Math.min(Math.max(0, amount), joint ? rule.capJointReturn : rule.cap);
  if (capped === 0) return Money.zero();
  const threshold = joint ? rule.thresholdJointReturn : rule.thresholdSingle;
  const over = Math.max(0, magi.toNumber() - threshold) / rule.phaseOutStep;
  const steps = rule.partialStepCounts ? Math.ceil(over) : Math.floor(over);
  return Money.from(Math.max(0, capped - steps * rule.phaseOutPerStep));
}
