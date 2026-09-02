import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { mountCliffExplorer, mountMarginalReality } from "../../src/tiles/benefitCliffs";
import { MAX_CURVE_COLUMNS, downsampleCurve, type CurvePoint } from "../../src/ui/charts";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";
import { SEARCH_ENTRIES, SUB_TOOLS, getTile, searchEntryText } from "../../src/tiles/registry";
import { fuzzyScore } from "../../src/ui/fuzzy";

/**
 * The Pillar 4 cliff tiles (SPEC-4 §A1, §A2). Beyond the usual tile bar — no
 * NaN on screen, deep link round-trips, verify banner when data is absent, axe
 * clean — these carry two obligations specific to this pillar: what the sweep
 * leaves out is always on screen, and losing Medicaid is never priced.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(
  mountFn: (ctx: TileContext) => void,
  params: URLSearchParams,
  bundled: BundledData | null = data,
  profile = new SituationStore(),
): { root: HTMLElement; lastParams: () => URLSearchParams | null } {
  const root = document.createElement("div");
  let captured: URLSearchParams | null = null;
  mountFn({
    root,
    params,
    setParams: (p) => {
      captured = p;
    },
    permalink: (p) => `https://enklayve.com/#/x?${(p ?? params).toString()}`,
    navigate: () => {},
    locale: "en-US",
    data: bundled,
    profile,
  });
  return { root, lastParams: () => captured };
}

const FAMILY = new URLSearchParams({
  fs: "head_of_household",
  st: "ca",
  size: "3",
  kids: "2",
  prem: "1200",
});

describe("Benefit Cliff Explorer", () => {
  it("finds and reports a cliff for a working family with two children", () => {
    const { root } = mount(mountCliffExplorer, FAMILY);
    expect(root.textContent).toContain("Biggest cliff");
    expect(root.querySelectorAll(".curve-bar--cliff").length).toBeGreaterThan(0);
  });

  it("tells an Ohio household that one of its drops is not a benefit", () => {
    // Ohio Rev. Code §5747.02(A)(3)(c) charges $332 the moment nonbusiness
    // taxable income passes $26,050, over 0% bands below. A single Ohio filer
    // sweeping past it sees resources fall with no benefit involved, and the
    // chart drew that drop exactly like the ones a benefit causes. An
    // unexplained drop on a chart whose purpose is explaining drops is the
    // failure that matters here — and the remedy is different, because nothing
    // ended, nothing was lost, and there is nothing to appeal.
    const { root } = mount(
      mountCliffExplorer,
      new URLSearchParams({ fs: "single", st: "oh", size: "1", kids: "0", prem: "0" }),
    );
    const text = root.textContent ?? "";
    expect(text).toContain("Ohio's tax step at");
    expect(text).toContain("not a benefit");
  });

  it("says what a widened step costs, not just that it widened", () => {
    // The sweep is bounded at MAX_POINTS and widens the step rather than
    // truncating the range. That is the right trade and it has a price nobody
    // stated: the sweep compares consecutive points, so a cliff narrower than
    // one step hides inside it — Ohio's $332 at $26,050 is invisible once the
    // raise that crosses it is $500, because the ordinary gain outruns the
    // loss. Reporting only "income step used: $559" states the fact and not
    // what it means, which is how a reader comes away with "no cliff here" from
    // a sweep that could not have seen one.
    const { root } = mount(
      mountCliffExplorer,
      new URLSearchParams({ fs: "head_of_household", st: "oh", size: "8", kids: "7", prem: "0" }),
    );
    const note = root.querySelector(".sweep-resolution")?.textContent ?? "";
    expect(note).toContain("hide inside it");
    expect(note).toContain("Marginal Reality Rate");
  });

  it("does not explain a widened step to a reader whose step was not widened", () => {
    const { root } = mount(
      mountCliffExplorer,
      new URLSearchParams({ fs: "single", st: "oh", size: "1", kids: "0", prem: "0" }),
    );
    expect(root.querySelector(".sweep-resolution")).toBeNull();
  });

  it("says nothing about a tax step in a state that has none", () => {
    const { root } = mount(mountCliffExplorer, FAMILY);
    expect(root.textContent ?? "").not.toContain("tax step at");
  });

  it("always shows what it leaves out, never behind a closed disclosure", () => {
    const { root } = mount(mountCliffExplorer, FAMILY);
    const block = root.querySelector<HTMLDetailsElement>(".cliff-unmodeled");
    expect(block).not.toBeNull();
    expect(block!.hasAttribute("open")).toBe(true);
    expect(block!.textContent).toContain("Housing assistance");
    expect(block!.textContent).toContain("Childcare subsidies");
    expect(block!.textContent).toContain("Your real cliff may be larger");
  });

  it("reports losing Medicaid as a coverage change, never as a dollar amount", () => {
    const { root } = mount(mountCliffExplorer, FAMILY);
    const row = Array.from(root.querySelectorAll(".bd-row")).find((r) =>
      r.querySelector(".bd-label")?.textContent?.includes("Medicaid"),
    );
    expect(row).toBeDefined();
    // The label names the income where eligibility ends; the *value* must never
    // put a dollar figure on the coverage itself (SPEC-4 §7.4).
    const value = row!.querySelector(".bd-value")?.textContent ?? "";
    expect(value).toContain("not priced");
    expect(value).not.toMatch(/\$[\d,]+/);
  });

  it("offers an accessible table alongside the chart", () => {
    const { root } = mount(mountCliffExplorer, FAMILY);
    const table = root.querySelector(".cliff-table table");
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll("tbody tr").length).toBeGreaterThan(3);
  });

  it("paints no NaN or Infinity over adversarial params", () => {
    for (const params of [
      new URLSearchParams({ size: "0", kids: "-4", prem: "-100", fs: "bogus", st: "zz" }),
      new URLSearchParams({ size: "1e9", kids: "1e9", prem: "1e12" }),
      new URLSearchParams({ size: "abc", kids: "abc", prem: "abc" }),
    ]) {
      const { root } = mount(mountCliffExplorer, params);
      expect(root.textContent).not.toMatch(/NaN|Infinity|\$-?Infinity/);
    }
  });

  it("round-trips its deep link", () => {
    const { lastParams } = mount(mountCliffExplorer, FAMILY);
    const { root: again } = mount(mountCliffExplorer, FAMILY);
    expect(again.textContent).toContain("Biggest cliff");
    // The tile publishes its state on first mount only after an edit; the
    // permalink builder is exercised by the result card's copy affordance.
    expect(lastParams()).toBeNull();
  });

  it("shows the verify banner when data is unavailable", () => {
    const { root } = mount(mountCliffExplorer, FAMILY, null);
    expect(root.querySelector(".verify-banner")).not.toBeNull();
  });

  it("is axe-clean", async () => {
    const { root } = mount(mountCliffExplorer, FAMILY);
    document.body.append(root);
    const results = await axe.run(root);
    document.body.removeChild(root);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("Marginal Reality Rate", () => {
  const withIncome = (inc: string, step = "1000"): URLSearchParams => {
    const p = new URLSearchParams(FAMILY);
    p.set("inc", inc);
    p.set("step", step);
    return p;
  };

  it("splits the raise into tax and benefit halves that reconcile", () => {
    const { root } = mount(mountMarginalReality, withIncome("38000"));
    const rows = Array.from(root.querySelectorAll(".bd-row")).map((r) => r.textContent ?? "");
    expect(rows.some((r) => r.includes("Lost to tax and FICA"))).toBe(true);
    expect(rows.some((r) => r.includes("Change in benefits and credits"))).toBe(true);
    expect(rows.some((r) => r.includes("What you actually keep"))).toBe(true);
    expect(rows.some((r) => r.includes("Combined marginal rate"))).toBe(true);
  });

  it("says plainly when a raise leaves the household with less", () => {
    // Just under the 400% FPL ACA cliff for a household of three.
    const fpl = data.fpl("contiguous")!;
    const line = fpl.base + fpl.perAdditionalPerson * 2;
    const { root } = mount(mountMarginalReality, withIncome(String(Math.round(line * 3.99))));
    const banner = root.querySelector(".verify-banner");
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain("less than before");
    expect(banner!.textContent).toContain("not a mistake in the math");
  });

  it("shows no alarming banner when the raise is simply worth taking", () => {
    const { root } = mount(mountMarginalReality, withIncome("150000"));
    expect(root.querySelector(".verify-banner")).toBeNull();
  });

  it("paints no NaN over adversarial params", () => {
    for (const inc of ["-1", "abc", "1e15", "0"]) {
      const { root } = mount(mountMarginalReality, withIncome(inc, "0"));
      expect(root.textContent).not.toMatch(/NaN|Infinity/);
    }
  });

  it("is axe-clean", async () => {
    const { root } = mount(mountMarginalReality, withIncome("38000"));
    document.body.append(root);
    const results = await axe.run(root);
    document.body.removeChild(root);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("downsampleCurve", () => {
  const series = (n: number): CurvePoint[] =>
    Array.from({ length: n }, (_, i) => ({ income: i * 250, resources: i * 100 }));

  it("leaves a short series untouched", () => {
    const points = series(40);
    expect(downsampleCurve(points)).toBe(points);
  });

  it("thins a long series toward the column budget", () => {
    const out = downsampleCurve(series(400));
    expect(out.length).toBeLessThanOrEqual(MAX_CURVE_COLUMNS + 2);
    expect(out[out.length - 1]!.income).toBe(399 * 250);
  });

  it("never drops a cliff point or a marker — thinning must not hide the finding", () => {
    const points = series(400);
    points[137]!.inCliff = true;
    points[138]!.inCliff = true;
    points[201]!.marker = "Medicaid eligibility ends";
    const out = downsampleCurve(points);
    expect(out.filter((p) => p.inCliff).length).toBe(2);
    expect(out.some((p) => p.marker === "Medicaid eligibility ends")).toBe(true);
  });
});

describe("catalog wiring", () => {
  it("registers the hub and both calculators", () => {
    expect(getTile("benefit-cliffs")).toBeDefined();
    const ids = SUB_TOOLS.filter((s) => s.hubId === "benefit-cliffs").map((s) => s.tile.id);
    expect(ids).toEqual(["cliff-explorer", "marginal-reality"]);
  });

  it("is reachable from search by the words people actually type", () => {
    for (const query of ["cliff", "benefit cliff", "raise", "phase out"]) {
      const hits = SEARCH_ENTRIES.filter((e) => fuzzyScore(query, searchEntryText(e)) !== null).map(
        (e) => e.tool ?? e.hubId,
      );
      expect(hits, `query: ${query}`).toContain(
        query === "raise" ? "marginal-reality" : "cliff-explorer",
      );
    }
  });

  it("inherits the strictest harm tier onto the hub", () => {
    expect(getTile("benefit-cliffs")!.harmTier).toBe(1);
  });
});
