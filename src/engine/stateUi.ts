/**
 * Unemployment insurance estimates from base-period wages (SPEC-4-safety-net
 * §B5). Pure: four quarters of wages and one state's rules in, the state's own
 * arithmetic out.
 *
 * There is no national rule to anchor to — UI is a federal-state program whose
 * benefit formulas are entirely the states' — so this module has no default
 * state and no fallback formula. A state without a bundled rule set gets no
 * estimate at all, which is the gate the spec sets: a "typical state" figure is
 * worse than nothing for someone deciding whether they can make rent.
 *
 * Every rounding step is the statute's own word (`up` in Texas §207.006, `down`
 * in Florida §443.111), applied to the exact quotient through decimal.js.
 */
import Decimal from "decimal.js";
import type { StateUiData } from "../data/schemas";

export interface UiInput {
  /** Wages paid in each of the four base-period quarters, in any order. */
  quarterlyWages: [number, number, number, number];
  /** Dependents claimed, for states that pay an allowance. */
  dependents?: number;
}

export interface UiResult {
  /** Whether any of the state's monetary-eligibility paths is met. */
  eligible: boolean;
  /** Why not, in the order the tests are applied — empty when eligible. */
  shortfalls: string[];
  highQuarterWages: number;
  basePeriodWages: number;
  quartersWithWages: number;
  /** The weekly benefit before dependents, after the minimum and maximum. */
  weeklyBenefit: number;
  /** Which rule produced the weekly figure. */
  weeklyBasis: "schedule" | "divisor" | "minimum" | "maximum";
  dependentAllowance: number;
  /** Weekly benefit plus any dependent allowance. */
  weeklyTotal: number;
  /** Total payable in the benefit year, and how many full weeks that buys. */
  maxBenefit: number;
  /** Which limit set the total. */
  maxBenefitBasis: "weeks" | "share-of-base-period" | "dollar-cap";
  weeks: number;
}

function wholeDollars(value: Decimal, rounding: "up" | "down"): number {
  return value
    .toDecimalPlaces(0, rounding === "up" ? Decimal.ROUND_CEIL : Decimal.ROUND_FLOOR)
    .toNumber();
}

/** The weekly benefit a high quarter produces, before the dependent allowance. */
function weeklyFrom(
  highQuarter: number,
  rules: StateUiData["weeklyBenefit"],
): { amount: number; basis: UiResult["weeklyBasis"] } | null {
  const schedule = rules.lowWageSchedule;
  if (schedule) {
    if (highQuarter < (schedule.rows[0]?.fromHighQuarter ?? 0)) return null;
    if (highQuarter < schedule.divisorFrom) {
      // The last row whose start is at or below the high quarter.
      let amount = 0;
      for (const row of schedule.rows) if (row.fromHighQuarter <= highQuarter) amount = row.amount;
      return { amount, basis: "schedule" };
    }
  }
  const raw = wholeDollars(
    new Decimal(highQuarter).dividedBy(rules.highQuarterDivisor),
    rules.rounding,
  );
  if (raw > rules.maximum) return { amount: rules.maximum, basis: "maximum" };
  if (raw < rules.minimum) return { amount: rules.minimum, basis: "minimum" };
  return { amount: raw, basis: "divisor" };
}

export function estimateUi(input: UiInput, rules: StateUiData): UiResult {
  const quarters = input.quarterlyWages.map((q) => Math.max(0, Number.isFinite(q) ? q : 0));
  const highQuarter = Math.max(...quarters);
  const basePeriod = quarters.reduce((a, b) => a + b, 0);
  const quartersWithWages = quarters.filter((q) => q > 0).length;

  const weekly = weeklyFrom(highQuarter, rules.weeklyBenefit);
  const weeklyBenefit = weekly?.amount ?? 0;

  // Monetary eligibility: any path, every test in it. Shortfalls are reported
  // for the first path only — the one a reader is most likely to be near — so
  // the list says what to look at rather than enumerating every route.
  const failures = rules.eligibility.map((path) => {
    const out: string[] = [];
    if (weekly === null) out.push("high-quarter wages below the lowest row of the benefit table");
    if (path.minHighQuarterWages !== undefined && highQuarter < path.minHighQuarterWages)
      out.push(`high-quarter wages under $${path.minHighQuarterWages.toLocaleString("en-US")}`);
    if (path.minBasePeriodWages !== undefined && basePeriod < path.minBasePeriodWages)
      out.push(`base-period wages under $${path.minBasePeriodWages.toLocaleString("en-US")}`);
    if (path.minQuartersWithWages !== undefined && quartersWithWages < path.minQuartersWithWages)
      out.push(`wages in fewer than ${path.minQuartersWithWages} quarters`);
    if (
      path.minBasePeriodToHighQuarter !== undefined &&
      new Decimal(basePeriod).lessThan(
        new Decimal(highQuarter).times(path.minBasePeriodToHighQuarter),
      )
    )
      out.push(`base-period wages under ${path.minBasePeriodToHighQuarter} times the high quarter`);
    if (
      path.minBasePeriodToWeeklyBenefit !== undefined &&
      basePeriod < weeklyBenefit * path.minBasePeriodToWeeklyBenefit
    )
      out.push(
        `base-period wages under ${path.minBasePeriodToWeeklyBenefit} times the weekly benefit`,
      );
    return out;
  });
  const eligible = failures.some((f) => f.length === 0);

  const allowances = rules.dependentAllowances?.perDependent ?? [];
  const dependents = Math.max(0, Math.floor(input.dependents ?? 0));
  const dependentAllowance = eligible
    ? allowances.slice(0, dependents).reduce((a, b) => a + b, 0)
    : 0;
  const weeklyTotal = eligible ? weeklyBenefit + dependentAllowance : 0;

  // The total payable is the least of the state's limits.
  const d = rules.duration;
  const candidates: { value: Decimal; basis: UiResult["maxBenefitBasis"] }[] = [
    { value: new Decimal(weeklyTotal).times(d.maxWeeks), basis: "weeks" },
  ];
  if (d.shareOfBasePeriodWages !== undefined)
    candidates.push({
      value: new Decimal(basePeriod).times(d.shareOfBasePeriodWages),
      basis: "share-of-base-period",
    });
  if (d.maxTotal !== undefined)
    candidates.push({ value: new Decimal(d.maxTotal), basis: "dollar-cap" });
  const least = candidates.reduce((a, b) => (b.value.lessThan(a.value) ? b : a));
  const maxBenefit = eligible
    ? d.totalRoundsDown
      ? least.value.toDecimalPlaces(0, Decimal.ROUND_FLOOR).toNumber()
      : least.value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
    : 0;
  // Full weeks the total pays at the weekly rate; a final partial week is paid
  // as the remainder, which is how every bundled state words it.
  const weeks =
    eligible && weeklyTotal > 0 ? Math.min(d.maxWeeks, Math.ceil(maxBenefit / weeklyTotal)) : 0;

  return {
    eligible,
    shortfalls: eligible ? [] : (failures[0] ?? []),
    highQuarterWages: highQuarter,
    basePeriodWages: basePeriod,
    quartersWithWages,
    weeklyBenefit: eligible ? weeklyBenefit : 0,
    weeklyBasis: weekly?.basis ?? "schedule",
    dependentAllowance,
    weeklyTotal,
    maxBenefit,
    maxBenefitBasis: least.basis,
    weeks,
  };
}
