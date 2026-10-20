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

/** To the nearest `step` dollars, half up, as Medicare rounds a premium. */
function toNearest(value: Decimal, step: number): Money {
  return Money.from(value.dividedBy(step).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).times(step));
}

export interface PenaltyInput {
  /** Full months after the initial enrollment period without Part B and without a special period. */
  monthsLateB: number;
  /** Months after the initial period without Part D or creditable coverage, past the 63-day grace. */
  monthsLateD: number;
  /** For someone who buys Part A: months late, and which premium they pay. */
  monthsLateA: number;
  partAPremium: "none" | "reduced" | "full";
}

export interface PenaltyResult {
  partB: { percent: number; monthly: Money; premiumWithPenalty: Money };
  partD: { percent: number; monthly: Money };
  partA: { percent: number; monthly: Money; years: number };
}

/**
 * The three late-enrollment penalties. Part B adds 10% of the standard premium
 * for each full 12 months late, for as long as the reader has Part B; Part D adds
 * 1% of the base beneficiary premium for each uncovered month, for as long as
 * they have Part D; bought Part A adds 10% for twice the full years late.
 */
export function medicarePenalties(input: PenaltyInput, costs: MedicareCostsData): PenaltyResult {
  const p = costs.penalties;
  const yearsB = Math.floor(Math.max(0, input.monthsLateB) / 12);
  const monthsD = Math.floor(Math.max(0, input.monthsLateD));
  const yearsA = Math.floor(Math.max(0, input.monthsLateA) / 12);
  const standard = new Decimal(costs.partB.standardMonthly);
  const pctB = new Decimal(p.partBPerFullYear).times(yearsB);
  const penaltyB = standard.times(pctB);
  const pctD = new Decimal(p.partDPerMonth).times(monthsD);
  const premiumA =
    input.partAPremium === "full"
      ? costs.partA.premiumFull
      : input.partAPremium === "reduced"
        ? costs.partA.premiumReduced
        : 0;
  const pctA = yearsA > 0 ? new Decimal(p.partAPerFullYear) : new Decimal(0);
  return {
    partB: {
      percent: pctB.toNumber(),
      monthly: Money.from(penaltyB).roundToCents(),
      premiumWithPenalty: toNearest(standard.plus(penaltyB), p.roundedTo),
    },
    partD: {
      percent: pctD.toNumber(),
      monthly: toNearest(new Decimal(costs.partD.baseBeneficiaryPremium).times(pctD), p.roundedTo),
    },
    partA: {
      percent: pctA.toNumber(),
      monthly: Money.from(new Decimal(premiumA).times(pctA)).roundToCents(),
      years: premiumA > 0 ? yearsA * p.partADurationMultiple : 0,
    },
  };
}
