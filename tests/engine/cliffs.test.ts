import { describe, it, expect, beforeAll } from "vitest";
import {
  CLIFF_NOISE_FLOOR,
  DEFAULT_STEP,
  MAX_POINTS,
  findCliffs,
  findStatusChanges,
  findTaxSteps,
  marginalReality,
  planSweep,
  resourcesAt,
  sweepResources,
  type CliffData,
  type CliffInput,
  type ResourcePoint,
} from "../../src/engine/cliffs";
import { loadBundledData, type BundledData } from "../../src/data/browser";

/**
 * The benefit-cliff engine (SPEC-4 §A1). The three "golden" cases below are the
 * ones the spec requires: an ACA subsidy edge, a Medicaid MAGI edge, and a SNAP
 * gross-income-test edge. Each is verified against the *same* bundled shards the
 * site ships, so a data refresh that moves a threshold moves the test with it.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function cliffData(overrides: Partial<CliffData> = {}): CliffData {
  return {
    tax: { federal: data.federal()!, fica: data.fica()! },
    fpl: data.fpl("contiguous"),
    eitcCtc: data.eitcCtc(),
    aca: data.aca(),
    snap: data.snap(),
    medicaid: data.medicaid(),
    snapRegionSupported: true,
    ...overrides,
  };
}

const family: CliffInput = {
  filingStatus: "head_of_household",
  householdSize: 3,
  qualifyingChildren: 2,
  stateCode: "ca",
  benchmarkMonthlyPremium: 0,
};

describe("planSweep: the bound is proven, and the range survives it", () => {
  it("uses the requested step when the point count fits", () => {
    const plan = planSweep(family, cliffData(), { from: 0, to: 50_000, step: DEFAULT_STEP });
    expect(plan.step).toBe(DEFAULT_STEP);
    expect(plan.stepWidened).toBe(false);
  });

  it("widens the step rather than truncating the range", () => {
    const plan = planSweep(family, cliffData(), { from: 0, to: 200_000, step: 50 });
    expect(plan.stepWidened).toBe(true);
    expect(plan.to).toBe(200_000);
    expect(Math.ceil((plan.to - plan.from) / plan.step) + 1).toBeLessThanOrEqual(MAX_POINTS);
  });

  it("never exceeds MAX_POINTS, whatever the caller asks for", () => {
    const result = sweepResources(family, cliffData(), { from: 0, to: 250_000, step: 1 });
    expect(result.points.length).toBeLessThanOrEqual(MAX_POINTS);
    expect(result.stepWidened).toBe(true);
  });

  it("degrades a hostile range instead of hanging or throwing", () => {
    for (const opts of [
      { from: Number.NaN, to: Number.NaN, step: Number.NaN },
      { from: 100_000, to: 0, step: -5 },
      { from: -50_000, to: 1e12, step: 0 },
    ]) {
      const result = sweepResources(family, cliffData(), opts);
      expect(result.points.length).toBeGreaterThan(0);
      expect(result.points.length).toBeLessThanOrEqual(MAX_POINTS);
      for (const p of result.points) expect(Number.isFinite(p.totalResources)).toBe(true);
    }
  });
});

describe("resourcesAt: every field is finite, for every household", () => {
  it("holds across filing statuses, household sizes, and incomes", () => {
    const statuses = ["single", "married_jointly", "head_of_household"] as const;
    for (const filingStatus of statuses) {
      for (const householdSize of [1, 3, 8]) {
        for (const income of [0, 1, 12_345, 60_000, 250_000]) {
          const point = resourcesAt(
            income,
            { ...family, filingStatus, householdSize, qualifyingChildren: householdSize - 1 },
            cliffData(),
          );
          for (const [key, value] of Object.entries(point)) {
            if (typeof value === "number") {
              expect(Number.isFinite(value), `${key} at ${income}`).toBe(true);
            }
          }
          expect(point.totalResources).toBeCloseTo(
            point.netAfterTax + point.credits + point.acaPremiumCredit + point.snapAllotment,
            6,
          );
        }
      }
    }
  });

  it("skips a term whose dataset is absent rather than inventing one", () => {
    const point = resourcesAt(30_000, family, cliffData({ eitcCtc: null, snap: null }));
    expect(point.credits).toBe(0);
    expect(point.snapAllotment).toBe(0);
    expect(Number.isFinite(point.totalResources)).toBe(true);
  });
});

describe("golden case 1: the SNAP gross-income-test edge", () => {
  /** The gross test is a hard cutoff at a percentage of the poverty line: one
   *  dollar over and the entire allotment goes to zero. */
  const grossLimit = (): number => {
    const snap = data.snap()!;
    const fpl = data.fpl("contiguous")!;
    return (
      ((fpl.base + fpl.perAdditionalPerson * 2) / 12) * (snap.grossIncomeLimitPctFpl / 100) * 12
    );
  };

  it("pays an allotment below the limit and nothing above it", () => {
    const grossLimitAnnual = grossLimit();
    const below = resourcesAt(grossLimitAnnual - 240, family, cliffData());
    const above = resourcesAt(grossLimitAnnual + 240, family, cliffData());
    expect(below.snapAllotment).toBeGreaterThan(0);
    expect(above.snapAllotment).toBe(0);
  });

  it("shows up as a drop in total resources across the edge", () => {
    const grossLimitAnnual = grossLimit();
    const result = sweepResources(family, cliffData(), {
      from: Math.max(0, grossLimitAnnual - 3_000),
      to: grossLimitAnnual + 3_000,
      step: 250,
    });
    const drops = result.cliffs.filter((c) => c.kind === "drop");
    expect(drops.length).toBeGreaterThan(0);
    expect(Math.max(...drops.map((d) => d.depth))).toBeGreaterThan(CLIFF_NOISE_FLOOR);
  });

  it("is skipped, and said to be skipped, outside the contiguous states", () => {
    const result = sweepResources(family, cliffData({ snapRegionSupported: false }), {
      from: 0,
      to: 40_000,
    });
    expect(result.points.every((p) => p.snapAllotment === 0)).toBe(true);
    expect(result.unmodeled.join(" ")).toContain("Alaska and Hawaii");
  });
});

describe("golden case 2: the Medicaid MAGI edge is a status change, never a dollar figure", () => {
  it("flips eligibility at the expansion threshold in an expansion state", () => {
    const medicaid = data.medicaid()!;
    const fpl = data.fpl("contiguous")!;
    const threshold = medicaid.thresholdOverridesPctFpl?.CA ?? medicaid.expansionThresholdPctFpl;
    const line = fpl.base + fpl.perAdditionalPerson * 2;
    const edge = line * (threshold / 100);

    expect(resourcesAt(edge - 1_000, family, cliffData()).medicaidEligible).toBe(true);
    expect(resourcesAt(edge + 1_000, family, cliffData()).medicaidEligible).toBe(false);

    const result = sweepResources(family, cliffData(), {
      from: edge - 4_000,
      to: edge + 4_000,
      step: 250,
    });
    expect(result.statusChanges).toHaveLength(1);
    expect(result.statusChanges[0]!.program).toBe("medicaid");
    expect(result.statusChanges[0]!.from).toBe(true);
    expect(result.statusChanges[0]!.to).toBe(false);
  });

  it("never converts losing Medicaid into money (SPEC-4 §7.4)", () => {
    const edge = 40_000;
    const before = resourcesAt(edge, family, cliffData());
    const after = resourcesAt(edge, { ...family, stateCode: "" }, cliffData());
    // Eligibility is reported, but it contributes nothing to the resource total:
    // the same income with and without a Medicaid determination totals the same.
    expect(before.medicaidEligible).not.toBeNull();
    expect(after.medicaidEligible).toBeNull();
    expect(before.totalResources).toBeCloseTo(after.totalResources, 6);
  });

  it("reports null, not false, where eligibility can't be determined", () => {
    const point = resourcesAt(30_000, { ...family, stateCode: "" }, cliffData());
    expect(point.medicaidEligible).toBeNull();
    expect(findStatusChanges([point, point])).toEqual([]);
  });
});

describe("golden case 3: the ACA 400%-FPL subsidy cliff", () => {
  const povertyLineFor3 = (): number => {
    const fpl = data.fpl("contiguous")!;
    return fpl.base + fpl.perAdditionalPerson * 2;
  };
  const withPremium: CliffInput = { ...family, benchmarkMonthlyPremium: 1_200 };

  it("pays a credit just under 400% FPL and nothing just over it", () => {
    const line = povertyLineFor3();
    const under = resourcesAt(line * 3.95, withPremium, cliffData());
    const over = resourcesAt(line * 4.05, withPremium, cliffData());
    expect(under.acaPremiumCredit).toBeGreaterThan(0);
    expect(over.acaPremiumCredit).toBe(0);
  });

  it("is a genuine drop: earning past the cliff leaves the household with less", () => {
    const line = povertyLineFor3();
    const result = sweepResources(withPremium, cliffData(), {
      from: line * 3.8,
      to: line * 4.2,
      step: 250,
    });
    const drops = result.cliffs.filter((c) => c.kind === "drop");
    expect(drops.length).toBeGreaterThan(0);
    // The lost credit is thousands of dollars, far past any rounding noise.
    expect(Math.max(...drops.map((d) => d.depth))).toBeGreaterThan(1_000);
  });

  it("pays no credit below 100% FPL, where the household is in Medicaid or the coverage gap", () => {
    const line = povertyLineFor3();
    expect(resourcesAt(line * 0.8, withPremium, cliffData()).acaPremiumCredit).toBe(0);
    expect(resourcesAt(line * 1.2, withPremium, cliffData()).acaPremiumCredit).toBeGreaterThan(0);
  });

  it("omits the ACA term, and says so, when no benchmark premium is given", () => {
    const result = sweepResources(family, cliffData(), { from: 0, to: 60_000 });
    expect(result.points.every((p) => p.acaPremiumCredit === 0)).toBe(true);
    expect(result.unmodeled.join(" ")).toContain("benchmark silver premium");
  });
});

describe("findCliffs", () => {
  const point = (grossIncome: number, totalResources: number): ResourcePoint => ({
    grossIncome,
    netAfterTax: totalResources,
    credits: 0,
    acaPremiumCredit: 0,
    snapAllotment: 0,
    totalResources,
    stateTaxableIncome: null,
    medicaidEligible: null,
  });

  it("finds nothing when resources rise throughout", () => {
    expect(findCliffs([point(0, 0), point(1_000, 900), point(2_000, 1_800)])).toEqual([]);
  });

  it("reports a drop with its width and depth", () => {
    const cliffs = findCliffs([point(0, 10_000), point(1_000, 6_000), point(2_000, 6_500)]);
    expect(cliffs).toHaveLength(1);
    expect(cliffs[0]).toMatchObject({
      kind: "drop",
      startIncome: 0,
      endIncome: 1_000,
      width: 1_000,
      depth: 4_000,
    });
  });

  it("merges a multi-step slide into one cliff, peak to trough", () => {
    const cliffs = findCliffs([
      point(0, 10_000),
      point(1_000, 9_000),
      point(2_000, 7_000),
      point(3_000, 8_000),
    ]);
    expect(cliffs).toHaveLength(1);
    expect(cliffs[0]!.depth).toBe(3_000);
    expect(cliffs[0]!.width).toBe(2_000);
  });

  it("calls a flat stretch a plateau, not a loss", () => {
    const cliffs = findCliffs([point(0, 5_000), point(1_000, 5_000), point(2_000, 5_500)]);
    expect(cliffs).toHaveLength(1);
    expect(cliffs[0]!.kind).toBe("plateau");
    expect(cliffs[0]!.depth).toBe(0);
  });

  it("discards cent-level rounding noise", () => {
    const cliffs = findCliffs([point(0, 5_000), point(1_000, 4_999.6), point(2_000, 6_000)]);
    expect(cliffs[0]!.kind).toBe("plateau");
  });
});

describe("marginalReality: what the next $1,000 actually costs", () => {
  it("splits the change into its tax and benefit halves", () => {
    const result = marginalReality(30_000, 1_000, family, cliffData());
    expect(result.taxDelta + result.benefitDelta).toBeCloseTo(result.netDelta, 6);
    expect(Number.isFinite(result.combinedRate)).toBe(true);
  });

  it("reports a rate above 100% rather than clamping it", () => {
    const fpl = data.fpl("contiguous")!;
    const line = fpl.base + fpl.perAdditionalPerson * 2;
    const result = marginalReality(
      line * 3.99,
      1_000,
      { ...family, benchmarkMonthlyPremium: 1_200 },
      cliffData(),
    );
    expect(result.netNegative).toBe(true);
    expect(result.combinedRate).toBeGreaterThan(1);
  });

  it("flags a Medicaid flip across the step without pricing it", () => {
    const medicaid = data.medicaid()!;
    const fpl = data.fpl("contiguous")!;
    const threshold = medicaid.thresholdOverridesPctFpl?.CA ?? medicaid.expansionThresholdPctFpl;
    const edge = (fpl.base + fpl.perAdditionalPerson * 2) * (threshold / 100);
    const result = marginalReality(edge - 200, 1_000, family, cliffData());
    expect(result.medicaidFlip).not.toBeNull();
    expect(result.medicaidFlip!.to).toBe(false);
  });
});

describe("a step in the state's own schedule is not a benefit cliff", () => {
  /**
   * A single Ohio filer sweeping past $26,050 sees resources fall about $130,
   * and no benefit is involved: Ohio Rev. Code §5747.02(A)(3)(c) owes nothing at
   * or below $26,050 of taxable income and "$332.00 plus 2.75% of the amount in
   * excess" above it, over 0% bands. The chart drew that drop like every other
   * one and could not say what it was — an unexplained drop on a chart whose
   * whole purpose is explaining drops.
   */
  const ohioSingle: CliffInput = {
    filingStatus: "single",
    householdSize: 1,
    qualifyingChildren: 0,
    stateCode: "oh",
    benchmarkMonthlyPremium: 0,
  };
  const withOhio = (): CliffData =>
    cliffData({
      tax: { federal: data.federal()!, fica: data.fica()!, state: data.state("oh") ?? undefined },
    });

  it("names Ohio's $332 step, at the income the sweep crosses it", () => {
    const result = sweepResources(ohioSingle, withOhio(), { from: 24_000, to: 30_000, step: 250 });
    expect(result.taxSteps).toEqual([
      {
        jurisdictionName: "Ohio",
        atIncome: 26_250,
        atTaxableIncome: 26_050,
        amount: 332,
      },
    ]);
    // And the drop it causes is still reported as a drop — the annotation
    // explains the cliff, it does not replace it.
    expect(result.cliffs.some((c) => c.kind === "drop" && c.startIncome === 26_000)).toBe(true);
  });

  it("says nothing about a range that does not reach the step", () => {
    const result = sweepResources(ohioSingle, withOhio(), { from: 5_000, to: 20_000, step: 250 });
    expect(result.taxSteps).toEqual([]);
  });

  it("says nothing in a state whose schedule has no step", () => {
    const result = sweepResources(
      { ...ohioSingle, stateCode: "ca" },
      cliffData({
        tax: { federal: data.federal()!, fica: data.fica()!, state: data.state("ca") ?? undefined },
      }),
      { from: 24_000, to: 30_000, step: 250 },
    );
    expect(result.taxSteps).toEqual([]);
  });

  it("says nothing when no state is modeled at all", () => {
    const result = sweepResources({ ...ohioSingle, stateCode: "" }, cliffData(), {
      from: 24_000,
      to: 30_000,
      step: 250,
    });
    expect(result.taxSteps).toEqual([]);
  });
});

/**
 * A sweep point sitting exactly on the statutory notch.
 *
 * `findTaxSteps` locates the interval where taxable income crosses a step in
 * the state's own schedule: `prev <= notch && now > notch`. The Ohio case above
 * never lands a point exactly on $26,050, so nothing held that `<=`, and
 * `npm run check:boundaries` reported it as newly unheld on 2026-09-03 — the
 * only unheld boundary in the engine that is not on the committed baseline with
 * a written reason.
 *
 * Flipping it does not shift the step by one point. It **loses the step
 * entirely**. With `<`, a point whose taxable income equals the notch fails
 * `prev < notch`, and every later interval has `prev > notch` and fails too, so
 * the loop runs out without ever pushing and without ever breaking. The reader
 * is left with exactly what this function was written to prevent: an
 * unexplained drop on a chart whose whole purpose is explaining drops. Ohio
 * charges $332 the moment taxable income passes $26,050, and a household that
 * lands on the threshold is the one most likely to be looking.
 *
 * Tested against `findTaxSteps` directly rather than through a sweep, because
 * the condition is about the points and the sweep's own gross-to-taxable offset
 * decides whether any point can land on the notch at all. The point is a pure
 * function of its inputs — its docstring says so — so this is the level the
 * boundary lives at.
 */
describe("a step is found when a point lands exactly on the notch", () => {
  const OHIO_NOTCH = { taxableIncome: 26_050, amount: 332 };

  /** A point carrying only what `findTaxSteps` reads. */
  const at = (grossIncome: number, stateTaxableIncome: number | null): ResourcePoint =>
    ({ grossIncome, stateTaxableIncome }) as ResourcePoint;

  it("reports the step when the previous point is exactly at the threshold", () => {
    // prev === 26,050 is the case `<` drops: `prev < notch` is false here, and
    // false at every later interval too, so the notch is never reported.
    const steps = findTaxSteps([at(26_000, 26_050), at(26_250, 26_300)], "Ohio", [OHIO_NOTCH]);
    expect(steps).toEqual([
      { jurisdictionName: "Ohio", atIncome: 26_250, atTaxableIncome: 26_050, amount: 332 },
    ]);
  });

  it("reports it once, at the first crossing, when the sweep runs on past", () => {
    const steps = findTaxSteps(
      [at(25_750, 25_800), at(26_000, 26_050), at(26_250, 26_300), at(26_500, 26_550)],
      "Ohio",
      [OHIO_NOTCH],
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]!.atIncome).toBe(26_250);
  });

  it("says nothing when the sweep stops on the threshold and never passes it", () => {
    // The other side of the same operator: at-or-below is not a crossing. The
    // statute charges the $332 on the amount in EXCESS of $26,050, so a
    // household exactly at the threshold owes nothing extra and must not be
    // told it does.
    expect(findTaxSteps([at(25_750, 25_800), at(26_000, 26_050)], "Ohio", [OHIO_NOTCH])).toEqual(
      [],
    );
  });

  it("skips a point with no state taxable income rather than treating it as zero", () => {
    // A null means no state is modeled at that point; reading it as 0 would
    // manufacture a crossing out of nothing.
    expect(findTaxSteps([at(26_000, null), at(26_250, 26_300)], "Ohio", [OHIO_NOTCH])).toEqual([]);
  });
});
