/**
 * The benefit-cliff engine (SPEC-4 §7.4, §A1) — the marquee Pillar 4 item.
 *
 * Every calculator on this site answers "what do I owe" or "what am I owed".
 * Neither answers the question that actually decides whether a working
 * household gets ahead: **if I earn more, am I better off?** Past a threshold,
 * the answer is sometimes no. A raise crosses an eligibility line, a credit
 * phases out faster than the wage grows, and total resources fall while gross
 * income rises. That is a *cliff*, and no consumer tool shows it, because the
 * households it happens to are not a lead-generation audience.
 *
 * This module sweeps income and sums what a household actually has:
 *
 *     total resources = wages
 *                     − federal income tax − FICA − state income tax
 *                     + EITC + refundable CTC
 *                     + ACA premium tax credit
 *                     + SNAP
 *
 * It composes engines that already exist and shards that are already bundled
 * and cited, so no new data is required — only the arithmetic nobody does.
 *
 * Three honesty rules are load-bearing, not decorative:
 *
 *   1. **Medicaid is never monetized.** Losing Medicaid is the largest cliff in
 *      American benefits, and pricing a household's coverage is not something we
 *      can do from public data. It is reported as a status change at the income
 *      where it happens, never converted to dollars. A number we cannot source
 *      would make the whole chart untrustworthy.
 *   2. **The sweep is bounded.** At most {@link MAX_POINTS} evaluations, with the
 *      step widened rather than the range truncated (SPEC-3 §2.7's "iterative
 *      loops have a proven upper bound").
 *   3. **What is not modeled is reported.** Housing assistance, childcare
 *      subsidies, WIC, LIHEAP, TANF, and state-only programs are not here, and
 *      several have steeper cliffs than anything that is. The caller renders
 *      {@link SweepResult.unmodeled} so the chart never reads as complete.
 */
import { Money } from "./money";
import {
  estimateCtc,
  estimateEitc,
  estimatePremiumTaxCredit,
  estimateSnap,
  medicaidEligibility,
  povertyLine,
} from "./benefits";
import { evaluateTaxes, type TaxContext } from "./tax";
import type { FilingStatus } from "../data/schemas";
import type {
  AcaData,
  EitcCtcData,
  FederalPovertyLevelData,
  MedicaidData,
  SnapData,
} from "../data/schemas";

/** Hard ceiling on sweep evaluations (SPEC-4 §7.4). */
export const MAX_POINTS = 400;
/** Default income step, and the range the step is clamped into. */
export const DEFAULT_STEP = 250;
export const MIN_STEP = 50;
export const MAX_STEP = 5_000;
/** Ceiling on the swept income range. */
export const MAX_INCOME = 250_000;
/**
 * A resource dip smaller than this is float noise from cent-level rounding
 * across five engines, not a cliff. Reporting it would cry wolf.
 */
export const CLIFF_NOISE_FLOOR = 1;

/** The household being swept. */
export interface CliffInput {
  filingStatus: FilingStatus;
  householdSize: number;
  /** Children who qualify for the EITC and the Child Tax Credit. */
  qualifyingChildren: number;
  /** Two-letter state code; "" when no state income tax is modeled. */
  stateCode: string;
  /**
   * The household's benchmark (second-lowest-cost silver) monthly premium, from
   * HealthCare.gov. Per-county, so the user supplies it; 0 opts the ACA term out.
   */
  benchmarkMonthlyPremium: number;
}

/** The datasets the sweep needs. Any may be absent; the sweep degrades. */
export interface CliffData {
  tax: TaxContext;
  fpl: FederalPovertyLevelData | null;
  eitcCtc: EitcCtcData | null;
  aca: AcaData | null;
  snap: SnapData | null;
  medicaid: MedicaidData | null;
  /**
   * SNAP allotments are bundled for the contiguous states only. Alaska and
   * Hawaii run on different tables, so the term is skipped and *said to be
   * skipped* rather than silently estimated at the wrong level.
   */
  snapRegionSupported: boolean;
}

/** One income step: what the household earns, and what it actually has. */
export interface ResourcePoint {
  grossIncome: number;
  /** Gross less federal income tax, FICA, and state income tax. */
  netAfterTax: number;
  /** EITC plus the refundable Child Tax Credit. */
  credits: number;
  /** Annual ACA premium tax credit. */
  acaPremiumCredit: number;
  /** Annual SNAP allotment (12 × the monthly estimate). */
  snapAllotment: number;
  /** The sum that matters. */
  totalResources: number;
  /** True/false in an expansion state; null where it can't be determined. */
  medicaidEligible: boolean | null;
}

/** A stretch of income where earning more does not leave you better off. */
export interface Cliff {
  /**
   * `"drop"` — resources actually fell; the raise cost money.
   * `"plateau"` — resources held flat; the raise bought nothing. Both are worth
   * seeing before taking the shift (SPEC-4 §A1, "flattens or falls"), but only
   * one of them is a loss, so they are never conflated.
   */
  kind: "drop" | "plateau";
  startIncome: number;
  endIncome: number;
  /** Income spanned by the cliff. */
  width: number;
  /** Resources lost from the peak to the trough. Zero for a plateau. */
  depth: number;
}

/** Where a discrete eligibility status changes — annotated, never priced. */
export interface StatusChange {
  program: "medicaid";
  /** The first swept income at which the new status holds. */
  atIncome: number;
  from: boolean;
  to: boolean;
}

export interface SweepOptions {
  from?: number;
  to?: number;
  step?: number;
}

export interface SweepResult {
  points: ResourcePoint[];
  cliffs: Cliff[];
  statusChanges: StatusChange[];
  /** The step actually used — may be wider than requested (see §7.4). */
  step: number;
  /** True when the step was widened to stay inside {@link MAX_POINTS}. */
  stepWidened: boolean;
  /** Programs excluded from this sweep, in plain English, for the caller to render. */
  unmodeled: string[];
}

/**
 * Programs and rules this sweep does not model, named so the chart is never read
 * as complete. Several of the omitted programs have steeper cliffs than anything
 * modeled here, so the honest statement to the user is "your real cliff may be
 * larger", never "here is your cliff".
 */
const ALWAYS_UNMODELED = [
  "Housing assistance (Section 8, public housing)",
  "Childcare subsidies (CCDF)",
  "WIC",
  "LIHEAP (energy assistance)",
  "TANF (cash assistance)",
  "State-only credits and programs, including state EITCs",
  // The refundable CTC phases in with earned income (a share of earnings above a
  // floor). The bundled shard carries the cap but not the phase-in, and we will
  // not hard-code a statutory literal to fill the gap (SPEC §2 principle 5, "no
  // orphan numbers"), so the refundable credit is shown at its cap. That
  // overstates resources at very low earnings; it is disclosed, not silent.
  "The refundable Child Tax Credit's phase-in with earned income — shown at its cap, so resources below roughly $15,000 of earnings read high",
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A finite, non-negative number, or the fallback. Keeps NaN off the screen. */
function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Choose the swept range and a step that keeps the point count at or under
 * {@link MAX_POINTS}. The range is preserved and the step widened, never the
 * reverse: a truncated range would silently hide the very cliff being looked
 * for, while a coarser step only blurs it.
 */
/**
 * How far up the income axis the sweep plots when the caller does not say.
 *
 * Four times the poverty line covers the benefit cliffs for the household size,
 * and the floor keeps a one-person household's chart from stopping below the
 * incomes people actually ask about. Both are choices this site made about a
 * chart, not figures anybody legislates — which is exactly why they are named:
 * a bound and a statutory figure look identical as inline literals.
 */
const SWEEP_FLOOR_TO = 60_000;
/** The same ceiling with no poverty-line data to scale against. */
const SWEEP_DEFAULT_TO = 100_000;

export function planSweep(
  input: CliffInput,
  data: CliffData,
  opts: SweepOptions = {},
): { from: number; to: number; step: number; stepWidened: boolean } {
  const from = clamp(finite(opts.from ?? 0), 0, MAX_INCOME);
  const defaultTo = data.fpl
    ? Math.max(4 * finite(povertyLine(input.householdSize, data.fpl).toNumber()), SWEEP_FLOOR_TO)
    : SWEEP_DEFAULT_TO;
  const to = clamp(finite(opts.to ?? defaultTo, defaultTo), from + MIN_STEP, MAX_INCOME);

  const requested = clamp(finite(opts.step ?? DEFAULT_STEP, DEFAULT_STEP), MIN_STEP, MAX_STEP);
  const span = to - from;
  const needed = Math.ceil(span / requested) + 1;
  if (needed <= MAX_POINTS) return { from, to, step: requested, stepWidened: false };

  // Widen just enough to fit, rounded up to a whole dollar.
  const widened = Math.min(MAX_STEP, Math.ceil(span / (MAX_POINTS - 1)));
  return { from, to, step: widened, stepWidened: true };
}

/** Compute one income point. Pure, and every field is guaranteed finite. */
export function resourcesAt(income: number, input: CliffInput, data: CliffData): ResourcePoint {
  const gross = Math.max(0, finite(income));
  const married =
    input.filingStatus === "married_jointly" ||
    input.filingStatus === "qualifying_surviving_spouse";

  const tax = evaluateTaxes({ filingStatus: input.filingStatus, wages: gross }, data.tax);
  const netAfterTax = finite(tax.totals.takeHome.toNumber());

  let credits = 0;
  if (data.eitcCtc) {
    const eitc = estimateEitc(
      { earnedIncome: gross, qualifyingChildren: input.qualifyingChildren, married },
      data.eitcCtc,
    );
    const ctc = estimateCtc(
      { qualifyingChildren: input.qualifyingChildren, magi: gross, married },
      data.eitcCtc,
    );
    credits = finite(eitc.credit.toNumber()) + finite(ctc.refundable.toNumber());
  }

  let acaPremiumCredit = 0;
  if (data.aca && data.fpl && input.benchmarkMonthlyPremium > 0) {
    const aca = estimatePremiumTaxCredit(
      {
        householdSize: input.householdSize,
        annualIncome: gross,
        benchmarkMonthlyPremium: input.benchmarkMonthlyPremium,
      },
      data.aca,
      data.fpl,
    );
    // Below 100% FPL there is no premium tax credit at all — that household is
    // in Medicaid territory (expansion states) or the coverage gap (the rest).
    // `annualCredit` is computed for display by the ACA tile regardless, so the
    // sweep must gate on `eligible` or it would invent thousands of dollars at
    // the low end and flatten the real step at the 100%-FPL line.
    acaPremiumCredit = aca.eligible ? finite(aca.annualCredit.toNumber()) : 0;
  }

  let snapAllotment = 0;
  if (data.snap && data.fpl && data.snapRegionSupported) {
    const snap = estimateSnap(
      { householdSize: input.householdSize, monthlyGrossIncome: gross / 12 },
      data.snap,
      data.fpl,
    );
    snapAllotment = finite(snap.monthlyBenefit.toNumber()) * 12;
  }

  let medicaidEligible: boolean | null = null;
  if (data.medicaid && data.fpl && input.stateCode) {
    medicaidEligible = medicaidEligibility(
      { stateCode: input.stateCode, income: gross, householdSize: input.householdSize },
      data.medicaid,
      data.fpl,
    ).eligible;
  }

  const totalResources = finite(netAfterTax + credits + acaPremiumCredit + snapAllotment);

  return {
    grossIncome: gross,
    netAfterTax,
    credits,
    acaPremiumCredit,
    snapAllotment,
    totalResources,
    medicaidEligible,
  };
}

/**
 * Find every stretch where total resources do not rise as income does.
 *
 * A cliff is a maximal contiguous run of non-increasing `totalResources`. A run
 * that loses at least {@link CLIFF_NOISE_FLOOR} is a `"drop"` — the raise cost
 * money. A run that neither rises nor meaningfully falls is a `"plateau"` — the
 * raise bought nothing, which is not a loss but is exactly what a household
 * deserves to know before taking the shift. Anything shallower than the floor is
 * cent-level rounding across five engines, not a finding.
 */
export function findCliffs(points: ResourcePoint[]): Cliff[] {
  const cliffs: Cliff[] = [];
  let i = 0;
  while (i < points.length - 1) {
    if (points[i + 1]!.totalResources > points[i]!.totalResources) {
      i++;
      continue;
    }
    // Extend while resources keep failing to rise.
    let j = i;
    while (j < points.length - 1 && points[j + 1]!.totalResources <= points[j]!.totalResources) {
      j++;
    }
    const peak = points[i]!;
    const trough = points[j]!;
    const depth = peak.totalResources - trough.totalResources;
    cliffs.push({
      kind: depth >= CLIFF_NOISE_FLOOR ? "drop" : "plateau",
      startIncome: peak.grossIncome,
      endIncome: trough.grossIncome,
      width: trough.grossIncome - peak.grossIncome,
      depth: depth >= CLIFF_NOISE_FLOOR ? depth : 0,
    });
    i = j;
  }
  return cliffs;
}

/** Discrete eligibility flips across the sweep — reported, never priced. */
export function findStatusChanges(points: ResourcePoint[]): StatusChange[] {
  const changes: StatusChange[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!.medicaidEligible;
    const now = points[i]!.medicaidEligible;
    if (prev !== null && now !== null && prev !== now) {
      changes.push({
        program: "medicaid",
        atIncome: points[i]!.grossIncome,
        from: prev,
        to: now,
      });
    }
  }
  return changes;
}

/** Sweep income and report the cliffs, the status flips, and what was left out. */
export function sweepResources(
  input: CliffInput,
  data: CliffData,
  opts: SweepOptions = {},
): SweepResult {
  const { from, to, step, stepWidened } = planSweep(input, data, opts);

  const points: ResourcePoint[] = [];
  for (let income = from; income <= to && points.length < MAX_POINTS; income += step) {
    points.push(resourcesAt(income, input, data));
  }

  const unmodeled = [...ALWAYS_UNMODELED];
  if (!data.snapRegionSupported) {
    unmodeled.unshift(
      "SNAP (Alaska and Hawaii use different allotment tables than the lower 48, which we haven't bundled)",
    );
  }
  if (input.benchmarkMonthlyPremium <= 0) {
    unmodeled.unshift(
      "The ACA premium tax credit (enter your benchmark silver premium from HealthCare.gov to include it)",
    );
  }

  return {
    points,
    cliffs: findCliffs(points),
    statusChanges: findStatusChanges(points),
    step,
    stepWidened,
    unmodeled,
  };
}

/**
 * The combined marginal rate on the next `delta` of income, **including benefit
 * phase-outs** (§A2, the Marginal Reality Rate). This is the sweep evaluated at
 * two adjacent points rather than across a range.
 *
 * The result can exceed 100%, and is deliberately not clamped: a household that
 * keeps none of its next $1,000 needs to see that, not a tidied-up number.
 */
export interface MarginalReality {
  fromIncome: number;
  toIncome: number;
  /** Change in take-home after tax only. */
  taxDelta: number;
  /** Change in credits + ACA + SNAP (negative when benefits phase out). */
  benefitDelta: number;
  /** Change in total resources. Negative means the raise cost money. */
  netDelta: number;
  /** Share of the raise lost to tax and lost benefits. 1.2 means 120%. */
  combinedRate: number;
  /** True when the household ends up with less than it started with. */
  netNegative: boolean;
  /** Set when Medicaid eligibility flips across this step — never priced. */
  medicaidFlip: StatusChange | null;
}

export function marginalReality(
  income: number,
  delta: number,
  input: CliffInput,
  data: CliffData,
): MarginalReality {
  const step = Math.max(1, finite(delta, 1000));
  const before = resourcesAt(income, input, data);
  const after = resourcesAt(income + step, input, data);

  const taxDelta = after.netAfterTax - before.netAfterTax;
  const benefitDelta =
    after.credits +
    after.acaPremiumCredit +
    after.snapAllotment -
    (before.credits + before.acaPremiumCredit + before.snapAllotment);
  const netDelta = after.totalResources - before.totalResources;

  const flips =
    before.medicaidEligible !== null &&
    after.medicaidEligible !== null &&
    before.medicaidEligible !== after.medicaidEligible;

  return {
    fromIncome: before.grossIncome,
    toIncome: after.grossIncome,
    taxDelta,
    benefitDelta,
    netDelta,
    combinedRate: finite((step - netDelta) / step),
    netNegative: netDelta < 0,
    medicaidFlip: flips
      ? {
          program: "medicaid",
          atIncome: after.grossIncome,
          from: before.medicaidEligible!,
          to: after.medicaidEligible!,
        }
      : null,
  };
}

/** Convenience for callers formatting money from the raw numbers above. */
export function asMoney(value: number): Money {
  return Money.from(finite(value));
}
