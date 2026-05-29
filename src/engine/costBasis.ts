/**
 * Cost-basis lot accounting (BUILD-SPEC.md §3.2): the FIFO / specific-
 * identification lot picker behind the Capital Gains cost-basis helper. Pure
 * arithmetic on the lots the user enters — given a sale price and which shares
 * are sold, it returns the realized gain split into short- and long-term (the
 * character that drives the capital-gains tax). Deterministic; no dataset.
 */
import { Money } from "./money";

export interface CostLot {
  /** Number of shares in the lot. */
  shares: number;
  /** Cost basis per share. */
  costPerShare: number;
  /** True when the lot was held more than one year at the sale date (long-term). */
  longTerm: boolean;
}

export interface LotSale {
  lot: CostLot;
  /** Shares sold from this lot. */
  sharesSold: number;
}

export interface CostBasisResult {
  sharesSold: number;
  shortTermProceeds: Money;
  shortTermBasis: Money;
  shortTermGain: Money;
  longTermProceeds: Money;
  longTermBasis: Money;
  longTermGain: Money;
  totalProceeds: Money;
  totalBasis: Money;
  totalGain: Money;
}

/**
 * First-in, first-out selection: consume lots in the order given (oldest first)
 * until `sharesToSell` is filled, taking a partial lot where needed.
 */
export function fifoSelect(lots: CostLot[], sharesToSell: number): LotSale[] {
  let remaining = Math.max(0, sharesToSell);
  const sales: LotSale[] = [];
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.max(0, lot.shares));
    if (take > 0) {
      sales.push({ lot, sharesSold: take });
      remaining -= take;
    }
  }
  return sales;
}

/**
 * Realized gain from a set of lot sales at a single sale price. Proceeds and
 * basis are bucketed by holding period so short-term (ordinary) and long-term
 * (preferential) gains are reported separately, ready to feed the Capital Gains
 * tile.
 */
export function costBasisGain(salePricePerShare: number, sales: LotSale[]): CostBasisResult {
  const price = Math.max(0, salePricePerShare);
  let stProceeds = Money.zero();
  let stBasis = Money.zero();
  let ltProceeds = Money.zero();
  let ltBasis = Money.zero();
  let sharesSold = 0;

  for (const sale of sales) {
    const n = Math.max(0, sale.sharesSold);
    if (n === 0) continue;
    const proceeds = Money.from(n).multiply(price);
    const basis = Money.from(n).multiply(Math.max(0, sale.lot.costPerShare));
    sharesSold += n;
    if (sale.lot.longTerm) {
      ltProceeds = ltProceeds.add(proceeds);
      ltBasis = ltBasis.add(basis);
    } else {
      stProceeds = stProceeds.add(proceeds);
      stBasis = stBasis.add(basis);
    }
  }

  const shortTermGain = stProceeds.subtract(stBasis);
  const longTermGain = ltProceeds.subtract(ltBasis);
  return {
    sharesSold,
    shortTermProceeds: stProceeds,
    shortTermBasis: stBasis,
    shortTermGain,
    longTermProceeds: ltProceeds,
    longTermBasis: ltBasis,
    longTermGain,
    totalProceeds: stProceeds.add(ltProceeds),
    totalBasis: stBasis.add(ltBasis),
    totalGain: shortTermGain.add(longTermGain),
  };
}
