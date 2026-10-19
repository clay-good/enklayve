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
  /** Weeks of the base period with at least the state's credit-week earnings (PA). */
  creditWeeks?: number;
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
  weeklyBasis:
    | "schedule"
    | "divisor"
    | "low-earner"
    | "average"
    | "floor"
    | "table"
    | "stepped-down"
    | "minimum"
    | "maximum";
  dependentAllowance: number;
  /** Weekly benefit plus any dependent allowance. */
  weeklyTotal: number;
  /** What a week actually pays, after any payment reduction the state takes. */
  weeklyPaid: number;
  /** Total payable in the benefit year, before any payment reduction. */
  maxBenefit: number;
  /** Which limit set the total. */
  maxBenefitBasis: "weeks" | "share-of-base-period" | "dollar-cap";
  weeks: number;
}

type Weekly = { amount: number; basis: UiResult["weeklyBasis"] };

function wholeDollars(value: Decimal, rounding: "up" | "down"): number {
  return value
    .toDecimalPlaces(0, rounding === "up" ? Decimal.ROUND_CEIL : Decimal.ROUND_FLOOR)
    .toNumber();
}

/** A banded table's rate and its row's minimum base-period total (PA §404(e)). */
function bandedRow(
  row: number,
  w: StateUiData["weeklyBenefit"],
  q: StateUiData["eligibility"][number]["bandedQualifyingWages"],
): { rate: number; qualifying: number } {
  const t = w.bandedTable!;
  const start = new Decimal(t.fromHighQuarter).plus(new Decimal(t.bandWidth).times(row));
  return {
    rate: wholeDollars(new Decimal(t.factor).times(t.baseRate + row), w.rounding),
    qualifying: q ? wholeDollars(start.plus(q.addend).dividedBy(q.share), "up") : 0,
  };
}

/** The weekly benefit wages produce, before the dependent allowance, or null for no claim. */
function weeklyFrom(
  quarters: number[],
  highQuarter: number,
  basePeriod: number,
  rules: StateUiData,
): Weekly | null {
  const w = rules.weeklyBenefit;
  const schedule = w.lowWageSchedule;
  if (schedule) {
    if (highQuarter < (schedule.rows[0]?.[0] ?? 0)) return null;
    if (highQuarter < schedule.divisorFrom) {
      // The last row whose start is at or below the high quarter.
      let amount = 0;
      for (const [from, weekly] of schedule.rows) if (from <= highQuarter) amount = weekly;
      return { amount, basis: "schedule" };
    }
  }
  let raw: number;
  let basis: Weekly["basis"];
  const t = w.bandedTable;
  if (t) {
    if (highQuarter < t.fromHighQuarter) return null;
    if (highQuarter >= t.maximumFrom) return { amount: w.maximum, basis: "maximum" };
    // Below its row's qualifying total the rate steps down to one of the next
    // rows whose total is met (PA §404(a)(3)); past those, there is no claim.
    const q = rules.eligibility[0]?.bandedQualifyingWages;
    const row = Math.floor((highQuarter - t.fromHighQuarter) / t.bandWidth);
    for (let k = 0; k <= (q?.stepDownRows ?? 0) && row - k >= 0; k++) {
      const r = bandedRow(row - k, w, q);
      if (basePeriod >= r.qualifying)
        return { amount: r.rate, basis: k ? "stepped-down" : "table" };
    }
    return null;
  }
  const divisor = w.highQuarterDivisor!;
  const lowEarner = w.lowEarner;
  const few = w.fewQuartersAverage;
  const withWages = quarters.filter((x) => x > 0).length;
  if (lowEarner && highQuarter <= lowEarner.atOrBelowHighQuarter) {
    raw = wholeDollars(new Decimal(highQuarter).dividedBy(lowEarner.divisor), w.rounding);
    basis = "low-earner";
  } else if (few && withWages < few.belowQuarters && highQuarter > few.aboveHighQuarter) {
    const top = [...quarters].sort((a, b) => b - a).slice(0, few.topQuarters);
    const average = top.reduce((a, b) => a.plus(b), new Decimal(0)).dividedBy(top.length);
    raw = wholeDollars(average.dividedBy(divisor), w.rounding);
    basis = "average";
  } else {
    raw = wholeDollars(new Decimal(highQuarter).dividedBy(divisor), w.rounding);
    basis = "divisor";
  }
  if (lowEarner && highQuarter > lowEarner.atOrBelowHighQuarter && raw < lowEarner.floorAbove) {
    raw = lowEarner.floorAbove;
    basis = "floor";
  }
  if (raw > w.maximum) return { amount: w.maximum, basis: "maximum" };
  if (raw < w.minimum) return { amount: w.minimum, basis: "minimum" };
  return { amount: raw, basis };
}

export function estimateUi(input: UiInput, rules: StateUiData): UiResult {
  const quarters = input.quarterlyWages.map((q) => Math.max(0, Number.isFinite(q) ? q : 0));
  const highQuarter = Math.max(...quarters);
  const basePeriod = quarters.reduce((a, b) => a + b, 0);
  const quartersWithWages = quarters.filter((q) => q > 0).length;
  const creditWeeks = Math.max(0, Math.floor(Number(input.creditWeeks) || 0));

  const weekly = weeklyFrom(quarters, highQuarter, basePeriod, rules);
  const weeklyBenefit = weekly?.amount ?? 0;

  // Monetary eligibility: any path, every test in it. Shortfalls are reported
  // for the first path only — the one a reader is most likely to be near — so
  // the list says what to look at rather than enumerating every route.
  const failures = rules.eligibility.map((path) => {
    const out: string[] = [];
    if (weekly === null)
      out.push(
        path.bandedQualifyingWages
          ? "high-quarter or total wages below the lowest rate the table allows"
          : "high-quarter wages below the lowest row of the benefit table",
      );
    if (path.minHighQuarterWages !== undefined && highQuarter < path.minHighQuarterWages)
      out.push(`high-quarter wages under $${path.minHighQuarterWages.toLocaleString("en-US")}`);
    if (path.minBasePeriodWages !== undefined && basePeriod < path.minBasePeriodWages)
      out.push(`base-period wages under $${path.minBasePeriodWages.toLocaleString("en-US")}`);
    if (path.minQuartersWithWages !== undefined && quartersWithWages < path.minQuartersWithWages)
      out.push(`wages in fewer than ${path.minQuartersWithWages} quarters`);
    if (path.minBasePeriodToHighQuarter !== undefined) {
      // Wages outside the high quarter against (ratio − 1) times the high
      // quarter, capped where the state caps it — the same test as "the total
      // is at least ratio times the high quarter" when there is no cap.
      const counted = Math.min(highQuarter, path.highQuarterCapForRatio ?? Infinity);
      const needed = new Decimal(counted).times(path.minBasePeriodToHighQuarter - 1);
      if (new Decimal(basePeriod - highQuarter).lessThan(needed))
        out.push(
          `base-period wages under ${path.minBasePeriodToHighQuarter} times the high quarter`,
        );
    }
    if (
      path.minShareOutsideHighQuarter !== undefined &&
      new Decimal(basePeriod - highQuarter).lessThan(
        new Decimal(basePeriod).times(path.minShareOutsideHighQuarter),
      )
    )
      out.push(
        `less than ${Math.round(path.minShareOutsideHighQuarter * 100)}% of base-period wages outside the high quarter`,
      );
    if (path.minCreditWeeks !== undefined && creditWeeks < path.minCreditWeeks)
      out.push(`fewer than ${path.minCreditWeeks} credit weeks`);
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
  const weeklyPaid =
    rules.paymentReduction === undefined
      ? weeklyTotal
      : wholeDollars(new Decimal(weeklyTotal).times(1 - rules.paymentReduction), "down");

  // The total payable is the least of the state's limits.
  const d = rules.duration;
  const maxWeeks = d.weeksFromCreditWeeks ? Math.min(d.maxWeeks, creditWeeks) : d.maxWeeks;
  const candidates: { value: Decimal; basis: UiResult["maxBenefitBasis"] }[] = [
    { value: new Decimal(weeklyTotal).times(maxWeeks), basis: "weeks" },
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
    eligible && weeklyTotal > 0 ? Math.min(maxWeeks, Math.ceil(maxBenefit / weeklyTotal)) : 0;

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
    weeklyPaid: eligible ? weeklyPaid : 0,
    maxBenefit,
    maxBenefitBasis: least.basis,
    weeks,
  };
}
