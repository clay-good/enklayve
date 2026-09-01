import { Money } from "../money";
import type {
  FilingStatus,
  NonItemizerCharitableData,
  SaltLimitationData,
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
 * SALT (capped), mortgage interest, charitable contributions, and medical
 * expenses above the AGI floor. AGI-based charitable limits and other refinements
 * are out of scope for this phase.
 */
export function itemizedTotal(itemized: ItemizedInput, agi: Money, saltCap: number): Money {
  const salt = Money.from(Math.min(itemized.stateAndLocalTaxes ?? 0, saltCap));
  const mortgage = Money.from(itemized.mortgageInterest ?? 0);
  const charitable = Money.from(itemized.charitable ?? 0);

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
): DeductionResult {
  const itemizedAmount = itemizedTotal(itemized, agi, saltCap);
  const takeStandard = (): DeductionResult => ({
    kind: "standard",
    amount: standardDeduction,
    nonItemizedCharitable,
  });
  const takeItemized = (): DeductionResult => ({
    kind: "itemized",
    amount: itemizedAmount,
    nonItemizedCharitable: Money.zero(),
  });
  if (mode === "standard") return takeStandard();
  if (mode === "itemized") return takeItemized();
  return itemizedAmount.greaterThan(standardDeduction.add(nonItemizedCharitable))
    ? takeItemized()
    : takeStandard();
}
