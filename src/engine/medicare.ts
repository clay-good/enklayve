/**
 * Medicare's income-related premiums (SPEC-5 Phase 29, later-life L1).
 *
 * IRMAA is a step function with no phase-out: one dollar over a tier's line
 * moves the whole year to the next tier. The tier is set by modified adjusted
 * gross income from two years before the premium year (42 U.S.C. §1395r(i)(4)).
 */
import Decimal from "decimal.js";
import { Money } from "./money";
import type { FilingStatus, IrmaaTier, MedicareCostsData } from "../data/schemas";

export type IrmaaSchedule = keyof MedicareCostsData["irmaa"]["schedules"];

/** The schedule a return files under; a separate return assumes the couple lived together. */
export function irmaaScheduleFor(status: FilingStatus): IrmaaSchedule {
  if (status === "married_jointly") return "joint";
  if (status === "married_separately") return "separate";
  return "individual";
}

function inTier(magi: Decimal, tier: IrmaaTier): boolean {
  return tier.atOrAbove ? magi.greaterThanOrEqualTo(tier.above) : magi.greaterThan(tier.above);
}

export interface IrmaaResult {
  /** 0 for the standard premium. */
  tierIndex: number;
  tierCount: number;
  partBMonthly: Money;
  partDMonthly: Money;
  /** Part B plus the Part D adjustment, a month and a year, for one person. */
  monthlyOne: Money;
  yearlyOne: Money;
  /** The surcharge over the standard premium, a year, for one person. */
  surchargeYearlyOne: Money;
  /** The next tier's line and how much more income stays under it; null at the top. */
  next: { line: Money; atOrAbove: boolean; room: Money } | null;
}

export function irmaaFor(
  magi: number,
  status: FilingStatus,
  costs: MedicareCostsData,
): IrmaaResult {
  const tiers = costs.irmaa.schedules[irmaaScheduleFor(status)];
  const m = new Decimal(Math.max(0, magi));
  let index = 0;
  for (let i = 0; i < tiers.length; i++) if (inTier(m, tiers[i]!)) index = i;
  const tier = tiers[index]!;
  const base = tiers[0]!;
  const partB = Money.from(tier.partBMonthly);
  const partD = Money.from(tier.partDMonthly);
  const monthly = partB.add(partD);
  const nextTier = tiers[index + 1];
  // Room under an exclusive line is the line itself; under an inclusive one,
  // a cent less, since reaching it moves the tier.
  const next = nextTier
    ? {
        line: Money.from(nextTier.above),
        atOrAbove: nextTier.atOrAbove,
        room: Money.from(
          Decimal.max(0, new Decimal(nextTier.above).minus(m).minus(nextTier.atOrAbove ? 0.01 : 0)),
        ),
      }
    : null;
  return {
    tierIndex: index,
    tierCount: tiers.length,
    partBMonthly: partB,
    partDMonthly: partD,
    monthlyOne: monthly,
    yearlyOne: monthly.multiply(12),
    surchargeYearlyOne: monthly
      .subtract(base.partBMonthly)
      .subtract(base.partDMonthly)
      .multiply(12),
    next,
  };
}
