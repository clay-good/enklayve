import { describe, it, expect, beforeAll } from "vitest";
import { amtScreen } from "../../src/engine/amt";
import {
  CLIFF_NOISE_FLOOR,
  DEFAULT_STEP,
  MAX_POINTS,
  findCliffs,
  planSweep,
  sweepResources,
  type CliffData,
  type CliffInput,
  type ResourcePoint,
} from "../../src/engine/cliffs";
import { loadBundledData, type BundledData } from "../../src/data/browser";

/**
 * The lines the engine draws for itself.
 *
 * Its companion file holds the thresholds a statute writes. These are the ones
 * *this codebase* chose: how close to regular tax counts as "you might owe AMT",
 * how small a dip is float noise rather than a benefit cliff, how many points a
 * chart may carry. Nothing outside the repo defines them, which makes them
 * easier to move by accident and harder to notice afterwards — there is no IRS
 * publication to check the result against, only the comment beside the constant.
 *
 * Each of these comparisons was on the unheld list. They are worth holding for
 * the same reason the statutory ones are: a number the reader sees turns on
 * them, and at the exact value the two readings disagree.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

describe("the AMT screener's verdict bands", () => {
  const base = {
    filingStatus: "single" as const,
    amtIncome: 0,
    regularTax: 0,
    hasIsoExercise: false,
    hasLargeSaltAddback: false,
  };

  it("says none, not maybe, when there is no AMT base and no regular tax", () => {
    // Income under the $90,100 exemption leaves an AMT base of exactly zero.
    // `baseNum <= 0` catches that first. Flipped to `<`, a base of exactly zero
    // falls through to the 85% comparison, where `0 >= 0 * 0.85` is *true* — so
    // a filer with no AMT exposure whatsoever is told they might owe it. The
    // worst possible reading of the worst possible input.
    const r = amtScreen({ ...base, amtIncome: 50_000, regularTax: 0 }, data.amt()!);
    expect(r.exemption.toNumber()).toBe(90_100);
    expect(r.tentativeMinimumTax.toNumber()).toBe(0);
    expect(r.verdict).toBe("none");
  });

  it("says maybe at exactly 85% of regular tax, the edge of the band", () => {
    // AMTI $175,100 − the $90,100 exemption = an $85,000 base, taxed at 26%
    // (below the $244,500 breakpoint) = a $22,100 tentative minimum tax. Against
    // a regular tax of $26,000 that is exactly 85%: the bottom of the band the
    // screener calls "close enough that a better AMTI estimate could flip it".
    const r = amtScreen({ ...base, amtIncome: 175_100, regularTax: 26_000 }, data.amt()!);
    expect(r.tentativeMinimumTax.toNumber()).toBe(22_100);
    expect(r.amtOwed.toNumber()).toBe(0);
    // Flipped to `>`, the filer exactly on the edge is told "none" — the one
    // answer that invites them to stop looking.
    expect(r.verdict).toBe("maybe");
  });

  it("says none just below the band and likely above regular tax", () => {
    const below = amtScreen({ ...base, amtIncome: 175_100, regularTax: 26_001 }, data.amt()!);
    expect(below.verdict).toBe("none");
    const likely = amtScreen({ ...base, amtIncome: 175_100, regularTax: 20_000 }, data.amt()!);
    expect(likely.verdict).toBe("likely");
    expect(likely.amtOwed.toNumber()).toBe(2_100);
  });

  it("charges one rate at exactly the 28% breakpoint, which is why it cannot be flipped", () => {
    // `baseNum <= breakpoint` is on the unheld list and stays there: at exactly
    // the breakpoint the two-rate formula reduces to the one-rate formula
    // ($244,500 × 26% + $0 × 28%), so both readings compute the same tax. It is
    // a split point, not a decision. Pinned anyway, because the *identity* is
    // what makes the branch redundant, and it would stop being redundant if the
    // second term ever gained a constant.
    const at = amtScreen({ ...base, amtIncome: 244_500 + 90_100 }, data.amt()!);
    expect(at.tentativeMinimumTax.toNumber()).toBeCloseTo(244_500 * 0.26, 6);
    const over = amtScreen({ ...base, amtIncome: 244_600 + 90_100 }, data.amt()!);
    expect(over.tentativeMinimumTax.toNumber()).toBeCloseTo(244_500 * 0.26 + 100 * 0.28, 6);
  });
});

describe("what counts as a cliff rather than rounding noise", () => {
  /**
   * Five engines contribute to `totalResources`, each rounding to cents, so a
   * dip of a few cents across a $250 income step is arithmetic, not a benefit
   * loss. The engine draws that line at $1 and reports anything shallower as a
   * "plateau" with a depth of zero — the raise bought nothing, which is true and
   * useful, rather than "a raise cost you $0.03", which is alarming and false.
   *
   * A dip of *exactly* $1 is the line itself, and both comparisons that decide
   * it were unheld.
   */
  const at = (grossIncome: number, totalResources: number): ResourcePoint => ({
    grossIncome,
    netAfterTax: totalResources,
    credits: 0,
    acaPremiumCredit: 0,
    snapAllotment: 0,
    totalResources,
    stateTaxableIncome: null,
    medicaidEligible: null,
  });

  it("calls a dip of exactly the noise floor a drop, and reports its depth", () => {
    expect(CLIFF_NOISE_FLOOR).toBe(1);
    const [cliff] = findCliffs([at(30_000, 20_000), at(30_250, 20_000 - CLIFF_NOISE_FLOOR)]);
    // Two flips live on this one dip: `kind` and `depth`. Flipped, the household
    // is shown a plateau of depth $0 where a dollar was actually lost.
    expect(cliff!.kind).toBe("drop");
    expect(cliff!.depth).toBe(1);
    expect(cliff!.startIncome).toBe(30_000);
    expect(cliff!.endIncome).toBe(30_250);
    expect(cliff!.width).toBe(250);
  });

  it("calls a dip one cent shallower a plateau of zero depth", () => {
    const [cliff] = findCliffs([at(30_000, 20_000), at(30_250, 19_999.01)]);
    expect(cliff!.kind).toBe("plateau");
    // The depth is zeroed rather than reported as $0.99: a plateau that carries
    // a depth would render as a loss in the tile's own summary line.
    expect(cliff!.depth).toBe(0);
  });

  it("calls a flat run a plateau too", () => {
    const [cliff] = findCliffs([at(30_000, 20_000), at(30_250, 20_000)]);
    expect(cliff!.kind).toBe("plateau");
    expect(cliff!.depth).toBe(0);
  });

  it("finds nothing in a run that only rises", () => {
    expect(findCliffs([at(30_000, 20_000), at(30_250, 20_100)])).toEqual([]);
  });
});

describe("the sweep's point budget and its endpoint", () => {
  const input: CliffInput = {
    filingStatus: "single",
    householdSize: 2,
    qualifyingChildren: 0,
    stateCode: "OH",
    benchmarkMonthlyPremium: 500,
  };
  const cliffData = (): CliffData => ({
    tax: { federal: data.federal()!, fica: data.fica()!, state: data.state("OH")! },
    fpl: data.fpl("contiguous"),
    eitcCtc: data.eitcCtc(),
    aca: data.aca(),
    snap: data.snap(),
    medicaid: data.medicaid(),
    snapRegionSupported: true,
  });

  it("keeps the requested step at exactly the point budget", () => {
    // 400 points is the cap. A $0–$99,750 range at the default $250 step needs
    // exactly 400 of them: `ceil(99750 / 250) + 1`.
    const span = DEFAULT_STEP * (MAX_POINTS - 1);
    const plan = planSweep(input, cliffData(), { from: 0, to: span, step: DEFAULT_STEP });
    expect(Math.ceil(span / DEFAULT_STEP) + 1).toBe(MAX_POINTS);
    expect(plan.step).toBe(DEFAULT_STEP);
    // The flag, not the step, is what moves here: widening a range that already
    // fits produces the same $250 step and tells the reader it was widened.
    expect(plan.stepWidened).toBe(false);
  });

  it("widens one point past the budget, and says so", () => {
    const plan = planSweep(input, cliffData(), {
      from: 0,
      to: DEFAULT_STEP * MAX_POINTS,
      step: DEFAULT_STEP,
    });
    expect(plan.stepWidened).toBe(true);
    expect(plan.step).toBeGreaterThan(DEFAULT_STEP);
  });

  it("includes the top of the range as a swept point", () => {
    // `income <= to` decides whether the last point exists. Flipped to `<`, the
    // chart silently loses its right-hand edge — and a cliff that begins at the
    // top of the swept range would be the one a household most needs to see,
    // because it is the one they are about to walk into.
    const r = sweepResources(input, cliffData(), { from: 0, to: 1_000, step: 250 });
    expect(r.points.map((p) => p.grossIncome)).toEqual([0, 250, 500, 750, 1_000]);
    expect(r.stepWidened).toBe(false);
  });
});
