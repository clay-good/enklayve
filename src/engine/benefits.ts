/**
 * Pillar 2 — What You're Owed (BUILD-SPEC.md §4). Deterministic eligibility and
 * benefit math: the Federal Poverty Level (the foundation nearly every program
 * keys off), the Earned Income Tax Credit, and the Child Tax Credit. Each is a
 * pure function of the inputs and the bundled, cited dataset — no inference.
 */
import { Money } from "./money";
import type { EitcCtcData, FederalPovertyLevelData } from "../data/schemas";

/** The poverty line for a household of `size` in the dataset's region (§4.1). */
export function povertyLine(size: number, fpl: FederalPovertyLevelData): Money {
  const people = Math.max(1, Math.floor(size));
  return Money.from(fpl.base).add(Money.from(fpl.perAdditionalPerson).multiply(people - 1));
}

/** Income as a percentage of the poverty line (e.g. 200 for 200% FPL). */
export function fplPercent(income: number, size: number, fpl: FederalPovertyLevelData): number {
  const line = povertyLine(size, fpl).toNumber();
  return line > 0 ? (Math.max(0, income) / line) * 100 : 0;
}

export interface EitcResult {
  /** Estimated credit. */
  credit: Money;
  /** The EITC bracket used (qualifying children, capped at 3+). */
  qualifyingChildren: number;
  /** True when income is past the point the credit fully phases out. */
  phasedOut: boolean;
}

/**
 * Estimate the Earned Income Tax Credit (§4.2). Phases in at `phaseInRate` up to
 * `maxCredit`, holds on a plateau, then phases out at `phaseOutRate` above the
 * filing-status threshold. Uses earned income as the income measure (the common
 * case; the statute uses the greater of earned income or AGI).
 */
export function estimateEitc(
  input: { earnedIncome: number; qualifyingChildren: number; married: boolean },
  data: EitcCtcData,
): EitcResult {
  const qc = Math.max(0, Math.min(3, Math.floor(input.qualifyingChildren)));
  const params = data.eitc.find((e) => e.qualifyingChildren === qc) ?? data.eitc[0];
  if (!params) {
    return { credit: Money.zero(), qualifyingChildren: qc, phasedOut: false };
  }
  const income = Math.max(0, input.earnedIncome);
  const phaseIn = Math.min(params.maxCredit, income * params.phaseInRate);
  const threshold = input.married
    ? params.phaseOutThresholdMarried
    : params.phaseOutThresholdSingle;
  const reduction = Math.max(0, income - threshold) * params.phaseOutRate;
  const credit = Math.max(0, phaseIn - reduction);
  return {
    credit: Money.from(credit),
    qualifyingChildren: qc,
    phasedOut: income > 0 && credit === 0 && income > threshold,
  };
}

export interface CtcResult {
  /** Total Child Tax Credit after the high-income phaseout. */
  credit: Money;
  /** Refundable portion available even with no tax liability (the ACTC), capped. */
  refundable: Money;
}

/**
 * Estimate the Child Tax Credit and its refundable portion (§4.2). The credit is
 * `perChild` per qualifying child, reduced by `phaseOutPerThousand` for every
 * $1,000 (or fraction) of MAGI above the filing-status threshold.
 */
export function estimateCtc(
  input: { qualifyingChildren: number; magi: number; married: boolean },
  data: EitcCtcData,
): CtcResult {
  const kids = Math.max(0, Math.floor(input.qualifyingChildren));
  const ctc = data.childTaxCredit;
  const base = ctc.perChild * kids;
  const threshold = input.married ? ctc.phaseOutThresholdMarried : ctc.phaseOutThresholdSingle;
  const excess = Math.max(0, Math.max(0, input.magi) - threshold);
  const steps = Math.ceil(excess / 1000);
  const reduction = steps * ctc.phaseOutPerThousand;
  const credit = Math.max(0, base - reduction);
  const refundable = Math.min(credit, ctc.refundableCap * kids);
  return { credit: Money.from(credit), refundable: Money.from(refundable) };
}
