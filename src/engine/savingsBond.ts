/**
 * Series I savings-bond math (BUILD-SPEC.md §3.4: Treasury I-bond and savings
 * bond fixed and inflation rates). Fully deterministic and straight from the
 * bundled TreasuryDirect rates — never a forecast. We only ever value a bond
 * through the last published rate period; we never project an unknown future
 * inflation rate (BUILD-SPEC.md §2.1).
 *
 * An I-bond's earning rate (the "composite rate") combines two parts:
 *   - a fixed rate, set when the bond is bought and locked for its life, and
 *   - a semiannual inflation rate, reset by the Treasury every six months.
 *
 * The published composite-rate formula (annualized):
 *   composite = fixed + (2 × semiInflation) + (fixed × semiInflation)
 * floored at 0 — a deflationary period can drag the composite to zero but the
 * bond never loses value.
 */
import { Money } from "./money";
import type { TreasuryBondsData } from "../data/schemas";

/** A single published six-month rate period. */
export interface BondRate {
  period: string;
  fixedRate: number;
  /** The semiannual inflation rate (half-year), as published. */
  inflationRate: number;
}

/**
 * The annualized composite rate from a (locked) fixed rate and a semiannual
 * inflation rate, per the TreasuryDirect formula. Floored at 0.
 */
export function compositeRate(fixedRate: number, semiannualInflationRate: number): number {
  const composite = fixedRate + 2 * semiannualInflationRate + fixedRate * semiannualInflationRate;
  return Math.max(0, composite);
}

/** The value of an I-bond over one held six-month period. */
export interface BondPeriodValue {
  period: string;
  /** The annualized composite rate earned over this period. */
  compositeRate: number;
  startValue: Money;
  interest: Money;
  endValue: Money;
}

export interface IBondProjection {
  /** The fixed rate locked at purchase, carried for the bond's life. */
  fixedRate: number;
  purchaseAmount: Money;
  /** One entry per six-month period held, oldest first. */
  periods: BondPeriodValue[];
  /** Number of six-month periods reflected (i.e. periods.length). */
  periodsHeld: number;
  /** Value after the last published period. */
  currentValue: Money;
  interestEarned: Money;
  /** The composite rate the most recent published period earns (annualized). */
  latestCompositeRate: number;
}

/** Available rate periods, oldest first (the order the dataset stores them in). */
export function ratePeriods(data: TreasuryBondsData): BondRate[] {
  return data.rates;
}

/**
 * Value a Series I bond bought in `purchasePeriod` through the last published
 * rate period. The fixed rate is taken from the purchase period and locked; the
 * inflation component rotates through each subsequent published period. Each
 * six-month period applies half the composite rate and rounds to the cent, the
 * way the Treasury accrues. Returns null if the purchase period is unknown.
 */
export function projectIBond(
  purchaseAmount: number,
  purchasePeriod: string,
  data: TreasuryBondsData,
): IBondProjection | null {
  const rates = data.rates;
  const startIndex = rates.findIndex((r) => r.period === purchasePeriod);
  if (startIndex < 0) return null;

  const fixedRate = rates[startIndex]!.fixedRate;
  const purchase = Money.from(purchaseAmount);

  const periods: BondPeriodValue[] = [];
  let balance = purchase;
  for (let i = startIndex; i < rates.length; i++) {
    const rate = compositeRate(fixedRate, rates[i]!.inflationRate);
    const startValue = balance;
    // Half the annual composite rate is earned over the six-month period.
    const endValue = startValue.multiply(1 + rate / 2).roundToCents();
    periods.push({
      period: rates[i]!.period,
      compositeRate: rate,
      startValue,
      interest: endValue.subtract(startValue),
      endValue,
    });
    balance = endValue;
  }

  const latest = rates[rates.length - 1]!;
  return {
    fixedRate,
    purchaseAmount: purchase,
    periods,
    periodsHeld: periods.length,
    currentValue: balance,
    interestEarned: balance.subtract(purchase),
    latestCompositeRate: compositeRate(fixedRate, latest.inflationRate),
  };
}
