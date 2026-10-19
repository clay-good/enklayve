/**
 * The taxable gain on selling a home, under IRC §121 (SPEC-5 Phase 28).
 *
 * Gain is the price less selling costs less basis. §121 excludes up to the
 * limit when the home was owned and used as a principal residence for two of
 * the five years before the sale and no other sale used the exclusion in the
 * two years before. A sale that misses those tests because of a move for work,
 * health or an unforeseen circumstance keeps a share of the limit: the shorter
 * of the qualifying period and the time since the last excluded sale, over two
 * years (§121(c)). What is left is taxed as a capital gain by the engine that
 * already does that, so this module adds no rate of its own.
 */
import Decimal from "decimal.js";
import { Money } from "./money";
import type { HomeSaleExclusionData } from "../data/schemas";

export interface HomeSaleInput {
  /** A joint return where both spouses meet the use test (§121(b)(2)(A)). */
  joint: boolean;
  salePrice: number;
  /** Commissions, transfer taxes and other costs of selling. */
  sellingCosts: number;
  /** What the home cost, plus improvements: the adjusted basis. */
  basis: number;
  /** Months owned and months lived in it, within the five years before the sale. */
  monthsOwned: number;
  monthsLived: number;
  /** Months since a prior sale used the exclusion, or null when none did. */
  monthsSincePriorExclusion: number | null;
  /** The sale was because of a job move, health, or an unforeseen circumstance. */
  qualifyingReason: boolean;
}

export type ExclusionBasis = "full" | "partial" | "none";

export interface HomeSaleResult {
  gain: Money;
  /** The exclusion limit that applies, after any §121(c) reduction. */
  limit: Money;
  /** The share of the full limit §121(c) allows; 1 for a full exclusion. */
  share: number;
  basis: ExclusionBasis;
  /** Why no exclusion, or a partial one, applies. */
  shortOf: string[];
  excluded: Money;
  taxableGain: Money;
  /** Owned more than a year, so the taxable part is a long-term gain. */
  longTerm: boolean;
}

export function homeSaleGain(input: HomeSaleInput, rules: HomeSaleExclusionData): HomeSaleResult {
  const need = rules.ownershipAndUseMonths;
  const window = rules.lookbackMonths;
  const owned = Math.min(window, Math.max(0, Math.floor(input.monthsOwned)));
  const lived = Math.min(window, Math.max(0, Math.floor(input.monthsLived)));
  const prior =
    input.monthsSincePriorExclusion === null
      ? null
      : Math.max(0, Math.floor(input.monthsSincePriorExclusion));
  const gain = Decimal.max(
    0,
    new Decimal(Math.max(0, input.salePrice))
      .minus(Math.max(0, input.sellingCosts))
      .minus(Math.max(0, input.basis)),
  );
  const full = input.joint ? rules.maxExclusionJoint : rules.maxExclusion;

  const shortOf: string[] = [];
  if (owned < need) shortOf.push(`owned it fewer than ${need} months of the last ${window}`);
  if (lived < need) shortOf.push(`lived in it fewer than ${need} months of the last ${window}`);
  if (prior !== null && prior < need)
    shortOf.push(`another sale used the exclusion within ${need} months`);

  let share = 1;
  let basis: ExclusionBasis = "full";
  if (shortOf.length > 0) {
    if (input.qualifyingReason) {
      // §121(c)(1)(B): the shorter of the owned-and-used period and the time
      // since the last excluded sale, over two years.
      const period = Math.min(owned, lived, prior ?? Infinity);
      share = Math.min(1, period / need);
      basis = "partial";
    } else {
      share = 0;
      basis = "none";
    }
  }
  const limit = new Decimal(full).times(share);
  const excluded = Decimal.min(gain, limit);
  return {
    gain: Money.from(gain),
    limit: Money.from(limit).roundToCents(),
    share,
    basis,
    shortOf,
    excluded: Money.from(excluded).roundToCents(),
    taxableGain: Money.from(gain.minus(excluded)).roundToCents(),
    longTerm: owned > 12,
  };
}
