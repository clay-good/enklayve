import { Money } from "./money";
import { bracketTax, bracketsFor } from "./tax/brackets";
import type { CapitalGainsData, FilingStatus, Jurisdiction } from "../data/schemas";

/**
 * Capital-gains tax (BUILD-SPEC.md §3.2). Deterministic, bracket-aware:
 *
 *  - Short-term gains (held ≤ 1 year) are ordinary income. They stack on top of
 *    your other ordinary taxable income through the federal ordinary brackets,
 *    so their tax is the difference the gain adds to the ordinary bill.
 *  - Long-term gains (held > 1 year) get the preferential 0/15/20% rates. They
 *    stack on top of ordinary income *and* short-term gains, so the bracket a
 *    long-term dollar lands in depends on everything beneath it.
 *  - The Net Investment Income Tax (NIIT) adds 3.8% on the lesser of net
 *    investment income or the amount of modified AGI above the filing-status
 *    threshold (IRC §1411).
 *
 * All arithmetic runs through decimal.js. Net losses are out of scope here, so a
 * negative gain is clamped to zero (the tool notes this).
 */

export interface CapitalGainsInput {
  filingStatus: FilingStatus;
  /** Ordinary taxable income (wages, interest, etc.) *before* any capital gains.
   *  This is what fills the brackets beneath the gains. */
  ordinaryTaxableIncome: number;
  /** Net short-term capital gain — taxed as ordinary income. */
  shortTermGain: number;
  /** Net long-term capital gain — taxed at the preferential rates. */
  longTermGain: number;
  /** Modified AGI used for the Net Investment Income Tax threshold test. */
  modifiedAgi: number;
}

/** One slice of the long-term gain taxed at a single preferential rate. */
export interface LongTermBand {
  rate: number;
  amount: Money;
  tax: Money;
}

export interface CapitalGainsResult {
  /** Ordinary tax the short-term gain adds (stacked on ordinary income). */
  shortTermTax: Money;
  /** Total long-term tax across the 0/15/20% bands. */
  longTermTax: Money;
  /** The long-term gain split across the bands it occupies. */
  longTermBands: LongTermBand[];
  /** 3.8% NIIT on net investment income above the MAGI threshold. */
  netInvestmentIncomeTax: Money;
  /** shortTermTax + longTermTax + NIIT — the total tax on the gains. */
  totalTax: Money;
  /** totalTax ÷ total gain (0 when there is no gain). */
  effectiveRateOnGains: number;
}

function clampGain(value: number): number {
  return Math.max(0, value);
}

/**
 * Split a long-term gain across the preferential brackets, given the ordinary
 * income (and short-term gain) it stacks on. Each band is the overlap of the
 * gain's interval [base, base + gain] with that bracket's range.
 */
function splitLongTerm(
  brackets: readonly { lowerBound: number; rate: number }[],
  base: number,
  gain: number,
): LongTermBand[] {
  const sorted = [...brackets].sort((a, b) => a.lowerBound - b.lowerBound);
  const start = base;
  const end = base + gain;
  const bands: LongTermBand[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const lower = sorted[i]!.lowerBound;
    const upper = i + 1 < sorted.length ? sorted[i + 1]!.lowerBound : Infinity;
    const lo = Math.max(start, lower);
    const hi = Math.min(end, upper);
    const amount = hi - lo;
    if (amount > 0) {
      const amt = Money.from(amount);
      bands.push({ rate: sorted[i]!.rate, amount: amt, tax: amt.multiply(sorted[i]!.rate) });
    }
  }
  return bands;
}

export function estimateCapitalGains(
  input: CapitalGainsInput,
  federal: Jurisdiction,
  data: CapitalGainsData,
): CapitalGainsResult {
  const ordinary = clampGain(input.ordinaryTaxableIncome);
  const shortTerm = clampGain(input.shortTermGain);
  const longTerm = clampGain(input.longTermGain);

  // Short-term gain stacks on ordinary income through the ordinary brackets.
  const ordinaryBrackets = bracketsFor(federal, input.filingStatus);
  const shortTermTax = bracketTax(Money.from(ordinary + shortTerm), ordinaryBrackets).subtract(
    bracketTax(Money.from(ordinary), ordinaryBrackets),
  );

  // Long-term gain stacks on top of ordinary income + short-term gain.
  const ltBase = ordinary + shortTerm;
  const ltBrackets = data.longTermBracketsByFilingStatus[input.filingStatus] ??
    data.longTermBracketsByFilingStatus.single ?? [{ lowerBound: 0, rate: 0.15 }];
  const longTermBands = splitLongTerm(ltBrackets, ltBase, longTerm);
  const longTermTax = longTermBands.reduce((sum, b) => sum.add(b.tax), Money.zero());

  // NIIT: 3.8% of the lesser of net investment income and MAGI over threshold.
  const threshold =
    data.niitThresholdByFilingStatus[input.filingStatus] ??
    data.niitThresholdByFilingStatus.single ??
    0;
  const overThreshold = Math.max(0, clampGain(input.modifiedAgi) - threshold);
  const netInvestmentIncome = shortTerm + longTerm;
  const niitBase = Math.min(netInvestmentIncome, overThreshold);
  const netInvestmentIncomeTax = Money.from(niitBase).multiply(data.netInvestmentIncomeTaxRate);

  const totalTax = shortTermTax.add(longTermTax).add(netInvestmentIncomeTax);
  const totalGain = shortTerm + longTerm;
  const effectiveRateOnGains =
    totalGain > 0 ? Math.round((totalTax.toNumber() / totalGain) * 1e6) / 1e6 : 0;

  return {
    shortTermTax,
    longTermTax,
    longTermBands,
    netInvestmentIncomeTax,
    totalTax,
    effectiveRateOnGains,
  };
}
