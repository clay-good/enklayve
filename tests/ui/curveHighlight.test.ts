import { describe, it, expect } from "vitest";
import {
  downsampleCurve,
  highlightIndex,
  resourceCurve,
  type CurvePoint,
} from "../../src/ui/charts";

/**
 * "You are here" on the benefit-cliff curve.
 *
 * The chart has taken a `highlightIncome` since it was written, the stylesheet
 * has carried a `.curve-col--here` rule, and nothing ever passed one — so the
 * marquee Pillar 4 chart showed where the cliff is and never where the reader
 * stands on it. The matching would not have worked either: it compared the
 * reader's income to a swept point with `Number.EPSILON`, an exact-equality
 * test on floats, and `downsampleCurve` would have thinned that exact column
 * away regardless, since it keeps only cliff columns, markers, and every
 * stride'th point.
 */
const at = (income: number, resources = 1000): CurvePoint => ({ income, resources });

describe("choosing the column a reader is standing on", () => {
  const points = [at(0), at(10_000), at(20_000), at(30_000), at(40_000)];

  it("takes the nearest drawn column, not an exact match", () => {
    // The reader's income lands between swept points essentially always.
    expect(highlightIndex(points, 19_999)).toBe(2);
    expect(highlightIndex(points, 20_001)).toBe(2);
    expect(highlightIndex(points, 24_999)).toBe(2);
    expect(highlightIndex(points, 25_001)).toBe(3);
    // An exact hit still works, which the old comparison did get right.
    expect(highlightIndex(points, 30_000)).toBe(3);
  });

  it("survives the thinning the chart applies before drawing", () => {
    // A fine sweep with no cliffs is thinned hard; the reader's own column is
    // not one of the kinds thinning protects, so it is gone by the time the
    // chart draws. Nearest-column matching is what makes that not matter.
    const fine = Array.from({ length: 400 }, (_, i) => at(i * 250));
    const drawn = downsampleCurve(fine);
    expect(drawn.length).toBeLessThan(fine.length);
    expect(drawn.some((p) => p.income === 62_150)).toBe(false);
    const i = highlightIndex(drawn, 62_150);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(Math.abs(drawn[i]!.income - 62_150)).toBeLessThan(1000);
  });

  it("marks nothing when the reader is off the plotted range", () => {
    // An income beyond the sweep highlighted at an endpoint would put the
    // reader somewhere they are not.
    expect(highlightIndex(points, 40_001)).toBe(-1);
    expect(highlightIndex(points, -1)).toBe(-1);
    // The ends themselves are on the chart.
    expect(highlightIndex(points, 0)).toBe(0);
    expect(highlightIndex(points, 40_000)).toBe(4);
  });

  it("marks nothing when there is nothing to mark", () => {
    expect(highlightIndex(points, undefined)).toBe(-1);
    expect(highlightIndex(points, NaN)).toBe(-1);
    expect(highlightIndex(points, Infinity)).toBe(-1);
    expect(highlightIndex([], 10_000)).toBe(-1);
  });
});

describe("what the chart does with it", () => {
  const points = [at(0), at(10_000), at(20_000), at(30_000)];

  it("tints exactly one column and says which in its title", () => {
    const fig = resourceCurve({
      points,
      locale: "en-US",
      ariaLabel: "Resources against income.",
      highlightIncome: 19_400,
    });
    const here = fig.querySelectorAll(".curve-col--here");
    expect(here).toHaveLength(1);
    expect(here[0]!.getAttribute("title")).toContain("You are about here");
    expect(here[0]!.getAttribute("title")).toContain("$20,000");
  });

  it("tells a screen reader too, since the whole chart is one image", () => {
    // A tinted column the label never mentions is a cue only sighted readers
    // receive.
    const fig = resourceCurve({
      points,
      locale: "en-US",
      ariaLabel: "Resources against income.",
      highlightIncome: 19_400,
    });
    expect(fig.getAttribute("aria-label")).toContain("Your current income, $20,000.00, is marked");
  });

  it("says nothing at all when nothing is highlighted", () => {
    const fig = resourceCurve({ points, locale: "en-US", ariaLabel: "Resources against income." });
    expect(fig.querySelectorAll(".curve-col--here")).toHaveLength(0);
    expect(fig.getAttribute("aria-label")).toBe("Resources against income.");
    expect(fig.querySelector(".curve-col")?.getAttribute("title")).not.toContain("You are");
  });
});
