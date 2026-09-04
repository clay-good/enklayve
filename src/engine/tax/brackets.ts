import { Money } from "../money";
import type { FilingStatus, Jurisdiction, LocalAddOnData } from "../../data/schemas";

/** A single marginal bracket (matches TaxBracketSchema). */
export interface Bracket {
  lowerBound: number;
  rate: number;
  /** A fixed amount added for income landing in this band (Ohio). See TaxBracketSchema. */
  baseTax?: number;
}

/**
 * Compute marginal-bracket tax on `taxable`. Brackets are sorted ascending
 * defensively; every dollar at or above a bracket's `lowerBound` (and below the
 * next bracket's) is taxed at that bracket's `rate`. This is the one generic
 * routine the whole engine uses for federal, state, and bracketed local tax —
 * adding a jurisdiction is data, not code (BUILD-SPEC.md §8).
 */
export function bracketTax(taxable: Money, brackets: readonly Bracket[]): Money {
  if (taxable.lessThanOrEqual(0) || brackets.length === 0) return Money.zero();
  const sorted = [...brackets].sort((a, b) => a.lowerBound - b.lowerBound);

  let tax = Money.zero();
  for (let i = 0; i < sorted.length; i++) {
    const lower = sorted[i]!.lowerBound;
    if (taxable.lessThanOrEqual(lower)) break;
    const nextLower = i + 1 < sorted.length ? sorted[i + 1]!.lowerBound : null;
    // The band runs from `lower` up to either the next bracket or the income.
    const ceiling = nextLower !== null && taxable.greaterThan(nextLower) ? nextLower : taxable;
    const bandAmount = (ceiling instanceof Money ? ceiling : Money.from(ceiling)).subtract(lower);
    tax = tax.add(bandAmount.multiply(sorted[i]!.rate));
    // A band may carry a fixed statutory amount on top of the marginal figure —
    // Ohio's "$332.00 plus 2.75% of the amount in excess of $26,050". Only the
    // band the income actually lands in contributes its base, so crossing into a
    // higher band does not stack the ones below (see TaxBracketSchema.baseTax).
    const base = sorted[i]!.baseTax;
    if (base !== undefined && (nextLower === null || taxable.lessThanOrEqual(nextLower))) {
      tax = tax.add(base);
    }
  }
  return tax;
}

/**
 * A point where the schedule itself charges more for one more dollar.
 *
 * `baseTax` is a flat amount the band carries on top of its marginal rate, and
 * when the bands below it do not carry one, that amount arrives WHOLE on the
 * first dollar over the boundary. Ohio is the case it was written for and the
 * only one in the repo today: Ohio Rev. Code §5747.02(A)(3)(c) owes nothing at
 * or below $26,050 of nonbusiness taxable income and states the band above as
 * "$332.00 plus 2.75% of the amount in excess of $26,050". Those lower bands are
 * 0%, so the $332 is not accumulated tax being restated — a filer at $26,050 who
 * earns one more dollar owes $332.03 instead of nothing.
 *
 * That is a real, printed feature of a state's schedule, and it lands on the
 * lowest income Ohio taxes at all. It is derived here rather than written down,
 * so a state that gains or loses one is described by its shard rather than by a
 * constant somebody has to remember.
 */
export interface StatutoryNotch {
  /** The taxable income at which one more dollar triggers the amount. */
  taxableIncome: number;
  /** What that dollar costs, before its own marginal rate. */
  amount: number;
}

export function statutoryNotches(brackets: readonly Bracket[]): StatutoryNotch[] {
  const sorted = [...brackets].sort((a, b) => a.lowerBound - b.lowerBound);
  const out: StatutoryNotch[] = [];
  for (let i = 1; i < sorted.length; i++) {
    // At exactly the boundary the band BELOW is still the one the income lands
    // in, so its own base is what the step is measured against — a schedule
    // where every band restates the accumulated tax has no notch anywhere.
    const step = (sorted[i]!.baseTax ?? 0) - (sorted[i - 1]!.baseTax ?? 0);
    if (step > 0) out.push({ taxableIncome: sorted[i]!.lowerBound, amount: step });
  }
  return out;
}

/** The statutory marginal rate of the band containing `taxable`. */
export function marginalBracketRate(taxable: Money, brackets: readonly Bracket[]): number {
  if (brackets.length === 0) return 0;
  const sorted = [...brackets].sort((a, b) => a.lowerBound - b.lowerBound);
  let rate = sorted[0]!.rate;
  for (const b of sorted) {
    if (taxable.greaterThanOrEqual(b.lowerBound)) rate = b.rate;
    else break;
  }
  return rate;
}

/**
 * The order in which to look up a filing status when a jurisdiction does not
 * define a separate schedule for it. The crucial case is **qualifying surviving
 * spouse**, which uses the married-filing-jointly schedule federally and in
 * essentially every state — so it must fall back to `married_jointly` *before*
 * `single`; falling straight to single (narrower brackets, smaller deduction)
 * overstates the tax. Married-filing-separately falls back to single, the
 * documented state-level assumption (many states tax MFS on the single
 * schedule). `single` is the universal last resort.
 */
function fallbackChain(status: FilingStatus): FilingStatus[] {
  if (status === "qualifying_surviving_spouse") {
    return [status, "married_jointly", "single"];
  }
  return status === "single" ? ["single"] : [status, "single"];
}

/**
 * Resolve the brackets for a filing status via {@link fallbackChain}. Throws
 * only if the jurisdiction defines no usable schedule at all.
 */
export function bracketsFor(jurisdiction: Jurisdiction, status: FilingStatus): Bracket[] {
  for (const candidate of fallbackChain(status)) {
    const brackets = jurisdiction.bracketsByFilingStatus[candidate];
    if (brackets) return brackets;
  }
  throw new Error(`${jurisdiction.id} defines no brackets for ${status} and no fallback`);
}

/**
 * Where a given rate's bracket starts, for this filing status.
 *
 * IRC §68 names its threshold rather than stating it — "the dollar amount at
 * which the 37 percent rate bracket under section 1 begins" — so the figure is
 * read out of the schedule the shard already carries instead of being copied
 * into a second field that could then disagree with the first. Undefined when
 * no bracket has that rate, which is every jurisdiction but the federal one.
 */
export function bracketStartForRate(
  jurisdiction: Jurisdiction,
  status: FilingStatus,
  rate: number,
): number | undefined {
  return bracketsFor(jurisdiction, status).find((b) => b.rate === rate)?.lowerBound;
}

/** Standard deduction for a status (via {@link fallbackChain}), 0 if none. */
export function standardDeductionFor(jurisdiction: Jurisdiction, status: FilingStatus): number {
  const table = jurisdiction.standardDeductionByFilingStatus;
  for (const candidate of fallbackChain(status)) {
    const amount = table[candidate];
    if (amount !== undefined) return amount;
  }
  return 0;
}

/**
 * IRC §63(f), the additional standard deduction for the aged.
 *
 * An addition to the *standard* deduction, so it reaches a filer who takes it
 * and nobody who itemizes — which is what separates it from §151(d)(5)(C)'s
 * $6,000, a deduction that comes off either way and stacks on top of this one.
 * The two are easy to conflate: both turn on being 65, both arrived in the same
 * revenue procedure, and this project modelled the newer one first and left the
 * older one out entirely. A 66-year-old single filer taking the standard
 * deduction was short $2,050 of it.
 *
 * §63(f)(3) is the reason there are two figures rather than one: the amount is
 * larger for an individual "unmarried and not a surviving spouse", so a single
 * or head-of-household filer gets $2,050 for 2026 where a joint filer gets
 * $1,650 for each qualifying spouse.
 *
 * Only the aged half is modelled. §63(f)(2) grants the same amount again for
 * blindness, and this site does not ask.
 */
export function agedStandardDeductionFor(
  jurisdiction: Jurisdiction,
  status: FilingStatus,
  qualifyingIndividuals: number,
): number {
  const amounts = jurisdiction.agedAdditionalStandardDeduction;
  if (!amounts) return 0;
  const n = Math.max(0, Math.floor(qualifyingIndividuals));
  if (n === 0) return 0;
  // "Unmarried and not a surviving spouse" is the statute's own test, so a
  // married-filing-separately filer takes the married amount and a qualifying
  // surviving spouse takes it too, by name.
  const unmarried = status === "single" || status === "head_of_household";
  const per = unmarried ? amounts.perPersonUnmarried : amounts.perPersonMarried;
  // Only a joint return can have two qualifying individuals on it.
  const cap = status === "married_jointly" || status === "qualifying_surviving_spouse" ? 2 : 1;
  return per * Math.min(n, cap);
}

/** Personal exemption for a status (via {@link fallbackChain}), 0 when none. */
export function personalExemptionFor(jurisdiction: Jurisdiction, status: FilingStatus): number {
  const table = jurisdiction.personalExemptionByFilingStatus;
  if (!table) return 0;
  for (const candidate of fallbackChain(status)) {
    const amount = table[candidate];
    if (amount !== undefined) return amount;
  }
  return 0;
}

/**
 * A LOCAL add-on's own personal exemption for a status (via {@link fallbackChain}),
 * or `undefined` when the locality has none — which is the common case, and the
 * signal that its base is the state's taxable income rather than one of its own.
 * Distinguishing "no exemption" from "an exemption of zero" matters here: they
 * select different bases, and a locality really could publish a $0 exemption.
 */
export function localExemptionFor(addOn: LocalAddOnData, status: FilingStatus): number | undefined {
  const table = addOn.personalExemptionByFilingStatus;
  if (!table) return undefined;
  for (const candidate of fallbackChain(status)) {
    const amount = table[candidate];
    if (amount !== undefined) return amount;
  }
  return undefined;
}

/**
 * The taxpayer-tax-credit phase-out base for a status (via {@link fallbackChain}),
 * 0 when the jurisdiction has no such credit or no base for the status. Resolves
 * married-filing-separately → single and qualifying surviving spouse → married
 * jointly the same way the brackets do, so an unlisted status is never charged a
 * $0 base (which would phase the credit out from the first dollar).
 */
export function taxpayerCreditBaseFor(jurisdiction: Jurisdiction, status: FilingStatus): number {
  const table = jurisdiction.taxpayerCredit?.basePhaseOutByFilingStatus;
  if (!table) return 0;
  for (const candidate of fallbackChain(status)) {
    const amount = table[candidate];
    if (amount !== undefined) return amount;
  }
  return 0;
}

/**
 * The standard-deduction phase-out parameters for a status (via {@link
 * fallbackChain}), or undefined when the jurisdiction has none. Resolves
 * married-filing-separately → single and qualifying surviving spouse → married
 * jointly the same way the brackets do, so an unlisted status phases out on the
 * right schedule (South Carolina's SCIAD, S.C. Code §12-6-1140(15); Wisconsin's
 * sliding deduction, Wis. Stat. §71.05(23)(a)). Exactly one of `divisor` or
 * `reductionRate` is present on the returned entry (the schema enforces it).
 */
export function standardDeductionPhaseOutFor(
  jurisdiction: Jurisdiction,
  status: FilingStatus,
):
  | {
      agiThreshold: number;
      divisor?: number;
      reductionRate?: number;
      floor?: number;
      secondSegment?: { base: number; reductionRate: number };
    }
  | undefined {
  const table = jurisdiction.standardDeductionPhaseOut?.byFilingStatus;
  if (!table) return undefined;
  for (const candidate of fallbackChain(status)) {
    const params = table[candidate];
    if (params !== undefined) return params;
  }
  return undefined;
}

/** Resolve a per-status value through {@link fallbackChain}; `undefined` if none. */
function resolveByStatus<T>(
  table: Partial<Record<string, T>> | undefined,
  status: FilingStatus,
): T | undefined {
  if (!table) return undefined;
  for (const candidate of fallbackChain(status)) {
    const value = table[candidate];
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * The deductible federal income tax for a status — the Alabama / Oregon
 * "federal tax paid" subtraction taken against state taxable income
 * (FederalTaxDeductionSchema). Returns `min(federalIncomeTax, cap)`, where the
 * cap is:
 *
 *  - **+∞ (uncapped)** when the jurisdiction sets no `capByFilingStatus` — the
 *    full federal liability is deductible (Alabama, Ala. Code §40-18-15(a)(1)),
 *    so the result is just `federalIncomeTax`;
 *  - otherwise the filing-status cap (via {@link fallbackChain}, so an unlisted
 *    status is never charged a $0 cap), **linearly phased out by federal AGI**
 *    when a `phaseOut` is present (Oregon, ORS §316.695): the full cap at or
 *    below `agiThreshold`, zero at or above `agiZero`, pro-rated between.
 *
 * Zero when the jurisdiction has no federal-tax deduction at all. The federal
 * income tax is the engine's own computed figure (already floored at zero by
 * {@link bracketTax}), so the deduction can never be negative.
 */
export function federalTaxDeductionFor(
  jurisdiction: Jurisdiction,
  status: FilingStatus,
  federalIncomeTax: Money,
  agi: Money,
): Money {
  const ftd = jurisdiction.federalTaxDeduction;
  if (!ftd) return Money.zero();

  // Uncapped (Alabama): the whole federal liability is deductible.
  if (!ftd.capByFilingStatus) return federalIncomeTax;

  let cap = resolveByStatus(ftd.capByFilingStatus, status) ?? 0;

  // AGI phase-out of the cap (Oregon): linear from full (≤ threshold) to 0 (≥ zero).
  const po = resolveByStatus(ftd.phaseOut?.byFilingStatus, status);
  if (po) {
    const a = agi.toNumber();
    if (a >= po.agiZero) {
      cap = 0;
    } else if (a > po.agiThreshold) {
      cap = (cap * (po.agiZero - a)) / (po.agiZero - po.agiThreshold);
    }
  }

  const capMoney = Money.from(Math.max(0, cap));
  return federalIncomeTax.lessThan(capMoney) ? federalIncomeTax : capMoney;
}

/**
 * The high-income benefit recapture to ADD to the bracket tax (Arkansas's
 * bracket adjustment; Connecticut's Table C + Table D). The per-status stage
 * list (via {@link fallbackChain}) falls back to the all-status `stages`; each
 * stage ramps linearly from 0 (at its `thresholdLow`) to `amount` (at
 * `thresholdHigh`) and stays `amount` above, and the contributions are summed —
 * so several stacked stages reproduce a multi-step schedule with flat holds.
 */
export function incomeRecaptureFor(
  jurisdiction: Jurisdiction,
  status: FilingStatus,
  taxable: number,
): number {
  const rec = jurisdiction.incomeRecapture;
  if (!rec) return 0;
  const stages = resolveByStatus(rec.byFilingStatus, status) ?? rec.stages ?? [];
  let add = 0;
  for (const s of stages) {
    if (taxable >= s.thresholdHigh) add += s.amount;
    else if (taxable > s.thresholdLow) {
      add += (s.amount * (taxable - s.thresholdLow)) / (s.thresholdHigh - s.thresholdLow);
    }
  }
  return add;
}

/**
 * The personal-tax-credit rate (a fraction of the tax) for a filer's AGI —
 * Connecticut's Table E. The per-status ascending step table (via {@link
 * fallbackChain}) returns the rate of the first row whose `agiUpTo` is at or
 * above the AGI, or 0 when AGI exceeds every row (or the jurisdiction has no
 * such credit). The caller applies `tax × (1 − rate)`.
 */
export function personalCreditRateFor(
  jurisdiction: Jurisdiction,
  status: FilingStatus,
  agi: number,
): number {
  const table = resolveByStatus(jurisdiction.personalCreditRate?.byFilingStatus, status);
  if (!table) return 0;
  for (const row of table) {
    if (agi <= row.agiUpTo) return row.rate;
  }
  return 0;
}
