/**
 * Tax-move math (BUILD-SPEC-2 §6.5): tax-loss harvesting and the Roth conversion
 * ladder. Both are deterministic arithmetic on the lots and amounts the user
 * enters — no prediction. The only statutory figures are the net-capital-loss
 * deduction limit (IRC §1211(b)) and the 5-year conversion seasoning rule (IRC
 * §408A(d)(3)), which the tiles cite.
 */
import { Money } from "./money";
import { clampYears } from "./finance";

export interface TaxLossHarvestInput {
  /** Realized short-term capital gains this year. */
  shortTermGain: number;
  /** Short-term losses available to realize (harvest). */
  shortTermLoss: number;
  /** Realized long-term capital gains this year. */
  longTermGain: number;
  /** Long-term losses available to realize (harvest). */
  longTermLoss: number;
  /** Marginal ordinary rate (%), taxing short-term gains and the ordinary offset. */
  ordinaryRatePct: number;
  /** Preferential long-term capital-gains rate (%). */
  longTermRatePct: number;
  /** Net-capital-loss deduction limit against ordinary income ($3,000; $1,500 MFS). */
  ordinaryOffsetLimit: number;
}

export interface TaxLossHarvestResult {
  /** Short-term gains net of short-term losses (signed). */
  netShortTerm: Money;
  /** Long-term gains net of long-term losses (signed). */
  netLongTerm: Money;
  /** Taxable short-term gain after cross-netting (≥ 0). */
  taxableShortTermGain: Money;
  /** Taxable long-term gain after cross-netting (≥ 0). */
  taxableLongTermGain: Money;
  /** Overall net capital loss after all netting (≥ 0). */
  netCapitalLoss: Money;
  /** Net loss deductible against ordinary income this year (≤ the limit). */
  deductibleAgainstOrdinary: Money;
  /** Net loss carried forward to future years. */
  lossCarryforward: Money;
  /** Capital-gains tax with no harvesting (gains taxed in full). */
  taxWithoutHarvesting: Money;
  /** Capital-gains tax after harvesting, net of the ordinary-income offset. */
  taxWithHarvesting: Money;
  /** Estimated tax saved by harvesting (≥ 0). */
  taxSaved: Money;
}

const nn = (n: number): number => Math.max(0, n);

/**
 * Tax-loss harvesting (BUILD-SPEC-2 §6.5). Nets short- and long-term gains and
 * losses per the Schedule D rules: like characters net first, then a net loss in
 * one category offsets a net gain in the other, with the surviving gain keeping
 * the character of the larger side. A remaining net loss offsets up to the
 * statutory limit of ordinary income this year; the rest carries forward.
 */
export function taxLossHarvest(input: TaxLossHarvestInput): TaxLossHarvestResult {
  const stGain = nn(input.shortTermGain);
  const ltGain = nn(input.longTermGain);
  const netShortTerm = Money.from(stGain).subtract(nn(input.shortTermLoss));
  const netLongTerm = Money.from(ltGain).subtract(nn(input.longTermLoss));
  const combined = netShortTerm.add(netLongTerm);

  let taxableShortTermGain = Money.zero();
  let taxableLongTermGain = Money.zero();
  let netCapitalLoss = Money.zero();

  if (!netShortTerm.isNegative() && !netLongTerm.isNegative()) {
    // Both categories are gains — each taxed at its own rate, no offset.
    taxableShortTermGain = netShortTerm;
    taxableLongTermGain = netLongTerm;
  } else if (combined.isNegative()) {
    // The losses exceed the gains overall — a net capital loss.
    netCapitalLoss = combined.negate();
  } else if (!combined.isZero()) {
    // A surviving gain keeps the character of the side that was positive.
    if (!netShortTerm.isNegative()) taxableShortTermGain = combined;
    else taxableLongTermGain = combined;
  }

  const ord = input.ordinaryRatePct / 100;
  const lt = input.longTermRatePct / 100;
  const taxOnGains = taxableShortTermGain.multiply(ord).add(taxableLongTermGain.multiply(lt));

  const limit = Money.from(nn(input.ordinaryOffsetLimit));
  const deductibleAgainstOrdinary = netCapitalLoss.lessThanOrEqual(limit) ? netCapitalLoss : limit;
  const lossCarryforward = netCapitalLoss.subtract(deductibleAgainstOrdinary);
  const ordinaryTaxSaved = deductibleAgainstOrdinary.multiply(ord);

  const taxWithHarvesting = taxOnGains.subtract(ordinaryTaxSaved);
  const taxWithoutHarvesting = Money.from(stGain)
    .multiply(ord)
    .add(Money.from(ltGain).multiply(lt));
  const taxSaved = taxWithoutHarvesting.subtract(taxWithHarvesting);

  return {
    netShortTerm,
    netLongTerm,
    taxableShortTermGain,
    taxableLongTermGain,
    netCapitalLoss,
    deductibleAgainstOrdinary,
    lossCarryforward,
    taxWithoutHarvesting,
    taxWithHarvesting,
    taxSaved,
  };
}

export interface RothLadderInput {
  /** The first year you make a conversion. */
  startYear: number;
  /** Amount converted from a traditional account to a Roth each year. */
  annualConversion: number;
  /** Number of years you keep converting (the length of the ladder). */
  ladderYears: number;
  /** Marginal ordinary rate (%), since each conversion is taxable income that year. */
  ordinaryRatePct: number;
  /** Years a conversion must season before it can be withdrawn penalty-free (5). */
  seasoningYears: number;
}

export interface RothLadderRung {
  /** The conversion year. */
  year: number;
  /** Amount converted that year. */
  converted: Money;
  /** Year this conversion becomes accessible penalty-free (year + seasoning). */
  accessibleYear: number;
  /** Estimated tax on the conversion that year (converted × ordinary rate). */
  estimatedTax: Money;
}

export interface RothLadderResult {
  rungs: RothLadderRung[];
  /** Total converted across the ladder. */
  totalConverted: Money;
  /** Total estimated conversion tax across the ladder. */
  totalEstimatedTax: Money;
  /** The first year converted funds become accessible (startYear + seasoning). */
  firstAccessibleYear: number;
  /** The steady amount unlocked each year once the ladder is seasoned. */
  annualAccessibleAmount: Money;
}

/**
 * Roth conversion ladder (BUILD-SPEC-2 §6.5). You convert a fixed amount from a
 * traditional account to a Roth each year; each conversion can be withdrawn
 * penalty-free after a 5-year seasoning period (IRC §408A(d)(3)). After the
 * first five years the conversions form a steady annual stream you can tap
 * before 59½. Deterministic; the conversion tax is estimated at the rate you
 * supply.
 */
export function rothConversionLadder(input: RothLadderInput): RothLadderResult {
  const years = clampYears(input.ladderYears);
  const seasoning = Math.max(0, Math.round(input.seasoningYears));
  const annual = Money.from(nn(input.annualConversion));
  const ord = input.ordinaryRatePct / 100;
  const taxPerRung = annual.multiply(ord);

  const rungs: RothLadderRung[] = [];
  for (let i = 0; i < years; i++) {
    const year = input.startYear + i;
    rungs.push({
      year,
      converted: annual,
      accessibleYear: year + seasoning,
      estimatedTax: taxPerRung,
    });
  }

  return {
    rungs,
    totalConverted: annual.multiply(years),
    totalEstimatedTax: taxPerRung.multiply(years),
    firstAccessibleYear: input.startYear + seasoning,
    annualAccessibleAmount: annual,
  };
}

export interface BackdoorRothInput {
  /** Nondeductible contribution to a traditional IRA (you then convert it). */
  contribution: number;
  /** Existing pre-tax IRA balance (traditional/SEP/SIMPLE) subject to pro-rata. */
  pretaxIraBalance: number;
  /** Marginal ordinary rate (%), taxing the pro-rata taxable portion. */
  ordinaryRatePct: number;
}

export interface BackdoorRothResult {
  /** The amount moved into the Roth (the contribution converted). */
  contribution: Money;
  /** Pro-rata taxable share: pretax ÷ (pretax + contribution). */
  taxableFraction: number;
  /** Taxable portion of the conversion (contribution × fraction). */
  taxablePortion: Money;
  /** Tax-free portion of the conversion (your nondeductible basis). */
  nontaxablePortion: Money;
  /** Tax owed on the conversion this year. */
  taxOwed: Money;
  /** True when no pre-tax IRA balance exists — a fully tax-free "clean" backdoor. */
  isClean: boolean;
}

/**
 * Backdoor Roth (BUILD-SPEC-2 §6.5): a nondeductible traditional-IRA
 * contribution converted to a Roth. The pro-rata rule (IRC §408(d)(2)) taxes the
 * conversion in proportion to your pre-tax IRA balances — so with no pre-tax IRA
 * money the conversion is tax-free, and with pre-tax balances part of it is
 * taxable. Deterministic from the inputs.
 */
export function backdoorRoth(input: BackdoorRothInput): BackdoorRothResult {
  const contributionNum = nn(input.contribution);
  const pretax = nn(input.pretaxIraBalance);
  const contribution = Money.from(contributionNum);
  const total = contributionNum + pretax;
  // Exact taxable portion = contribution × pretax / total (avoids float fraction).
  const taxablePortion = total === 0 ? Money.zero() : contribution.multiply(pretax).divide(total);
  const nontaxablePortion = contribution.subtract(taxablePortion);
  const taxOwed = taxablePortion.multiply(input.ordinaryRatePct / 100);
  return {
    contribution,
    taxableFraction: total === 0 ? 0 : pretax / total,
    taxablePortion,
    nontaxablePortion,
    taxOwed,
    isClean: pretax === 0,
  };
}

export interface MegaBackdoorInput {
  /** The §415(c) total defined-contribution limit for the year. */
  definedContributionLimit: number;
  /** Your elective 401(k) deferrals so far (traditional + Roth). */
  electiveDeferral: number;
  /** Employer contributions (match + profit sharing). */
  employerContributions: number;
}

export interface MegaBackdoorResult {
  /** After-tax 401(k) room available to convert to Roth (≥ 0). */
  afterTaxRoom: Money;
}

/**
 * Mega-backdoor Roth (BUILD-SPEC-2 §6.5): after-tax 401(k) contributions, up to
 * the §415(c) overall limit less your elective deferrals and employer
 * contributions, then converted to Roth (in-plan or rolled out). The age-50
 * catch-up sits on top of §415(c), so it is excluded here. Deterministic.
 */
export function megaBackdoorRoth(input: MegaBackdoorInput): MegaBackdoorResult {
  const room = Money.from(nn(input.definedContributionLimit))
    .subtract(nn(input.electiveDeferral))
    .subtract(nn(input.employerContributions));
  return { afterTaxRoom: room.isNegative() ? Money.zero() : room };
}
