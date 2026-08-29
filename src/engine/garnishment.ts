/**
 * Wage garnishment ceilings under the Consumer Credit Protection Act Title III
 * (SPEC-4-safety-net §B2). Pure: limits in, ceiling out.
 *
 * The whole module is a **federal floor on protection, not the answer**. Every
 * state may prohibit garnishment or allow less of it, and where one does, the
 * state rule is what governs (15 U.S.C. §1677). The tile that renders this puts
 * that sentence *above* the number, because the single way this tool could do
 * harm is by reading as "so they can take $X" when a household's own state
 * would let them take far less — or nothing.
 *
 * The per-pay-period protected amounts are derived from the one statutory
 * weekly figure (thirty times the federal minimum hourly wage) rather than
 * stored as four literals, so there is one number to refresh when the minimum
 * wage moves and no way for the four to drift apart.
 */
import { Money } from "./money";
import type { GarnishmentLimitsData } from "../data/schemas";

/** How often the household is paid. */
export type PayPeriod = "weekly" | "biweekly" | "semimonthly" | "monthly";

/**
 * Weeks per pay period, as an exact fraction. Semi-monthly and monthly are not
 * whole weeks, so the statutory weekly floor scales by 52/24 and 52/12 — the
 * same equivalents the Secretary of Labor prescribes under §1673(a) for
 * non-weekly periods. Kept as a numerator and denominator, and applied through
 * {@link Money}, because evaluating `52 / 24` in floating point yields
 * $471.24999999999994 where the statute means $471.25.
 */
const WEEKS_PER_PERIOD: Record<PayPeriod, { periodsPerYear: number }> = {
  weekly: { periodsPerYear: 52 },
  biweekly: { periodsPerYear: 26 },
  semimonthly: { periodsPerYear: 24 },
  monthly: { periodsPerYear: 12 },
};

/** Weeks in a year, the numerator every non-weekly equivalent scales from. */
const WEEKS_PER_YEAR = 52;

/** What the garnishment is for. The category, not the amount, decides the rule. */
export type GarnishmentKind = "ordinary" | "support" | "tax" | "bankruptcy";

export interface GarnishmentInput {
  /** Disposable earnings for one pay period — pay after legally required deductions. */
  disposableEarnings: number;
  payPeriod: PayPeriod;
  kind: GarnishmentKind;
  /** §1673(b)(2)(A): supporting another spouse or dependent child lowers the cap. */
  supportingOtherDependents?: boolean;
  /** §1673(b)(2): arrears for a period before the twelve weeks ending with this
   * workweek raise the cap by five points. */
  arrearsOlderThanTwelveWeeks?: boolean;
}

export interface GarnishmentResult {
  /**
   * The most federal law lets a creditor take this pay period, or null where
   * Title III sets no ceiling at all (a tax debt, a chapter 13 order). Null is
   * not "unlimited" — it means a different rule applies, named by the shard.
   */
  federalMaximum: Money | null;
  /** What is left after that maximum, or null alongside a null maximum. */
  remaining: Money | null;
  /** The §1673(a)(2) floor for this pay period — earnings below it are untouchable. */
  protectedFloor: Money;
  /** Which test produced the ceiling, so the tile can show its work. */
  binding: "percentage" | "protected-floor" | "support-share" | "no-federal-ceiling";
  /** The share applied, for the "show the math" line. Zero when none applies. */
  shareApplied: number;
}

/** Clamp to a finite, non-negative number — a hostile deep link never reaches the math. */
function at(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * The amount of a pay period's earnings that garnishment for an ordinary debt
 * cannot reach: thirty times the federal minimum hourly wage per week, scaled to
 * the pay period.
 */
export function protectedFloor(limits: GarnishmentLimitsData, payPeriod: PayPeriod): Money {
  const weekly = Money.from(at(limits.protectedHoursMultiple)).multiply(
    at(limits.federalMinimumHourlyWage),
  );
  const { periodsPerYear } = WEEKS_PER_PERIOD[payPeriod] ?? WEEKS_PER_PERIOD.weekly;
  return weekly.multiply(WEEKS_PER_YEAR).divide(periodsPerYear);
}

/**
 * The federal ceiling on one pay period's garnishment (§1673).
 *
 * Ordinary debt takes the *lesser* of two tests: a quarter of disposable
 * earnings, or everything above the protected floor. Support orders are exempt
 * from both and carry their own share instead. Tax debt and chapter 13 orders
 * have no Title III ceiling — the result says so rather than returning a number
 * that would be wrong in either direction.
 */
export function garnishmentCeiling(
  input: GarnishmentInput,
  limits: GarnishmentLimitsData,
): GarnishmentResult {
  const disposable = at(input.disposableEarnings);
  const floor = protectedFloor(limits, input.payPeriod);

  if (input.kind === "tax" || input.kind === "bankruptcy") {
    return {
      federalMaximum: null,
      remaining: null,
      protectedFloor: floor,
      binding: "no-federal-ceiling",
      shareApplied: 0,
    };
  }

  if (input.kind === "support") {
    const base = input.supportingOtherDependents
      ? limits.supportOrder.supportingOtherDependentsShare
      : limits.supportOrder.notSupportingOtherDependentsShare;
    const share = Math.min(
      1,
      base + (input.arrearsOlderThanTwelveWeeks ? limits.supportOrder.arrearsSurchargeShare : 0),
    );
    const max = Money.from(disposable * share);
    return {
      federalMaximum: max,
      remaining: Money.from(disposable).subtract(max),
      protectedFloor: floor,
      binding: "support-share",
      shareApplied: share,
    };
  }

  const share = Math.min(1, Math.max(0, limits.ordinaryDebtMaxShare));
  const byPercentage = disposable * share;
  const aboveFloor = Math.max(0, disposable - floor.toNumber());
  const max = Math.min(byPercentage, aboveFloor);
  return {
    federalMaximum: Money.from(max),
    remaining: Money.from(disposable - max),
    protectedFloor: floor,
    // Ties go to the floor: at the crossover the two tests agree, and naming the
    // floor is the more useful half of the sentence for someone at that income.
    binding: aboveFloor <= byPercentage ? "protected-floor" : "percentage",
    shareApplied: share,
  };
}
