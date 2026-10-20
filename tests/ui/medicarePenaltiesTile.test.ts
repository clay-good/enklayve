import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { medicarePenalties } from "../../src/engine/medicare";
import { medicarePenaltiesTile } from "../../src/tiles/medicarePenalties";
import { mountMedicarePenalties } from "../../src/tiles/medicarePenaltiesView";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import type { MedicareCostsData } from "../../src/data/schemas";
import type { TileContext } from "../../src/tiles/types";

/**
 * Medicare Enrollment Penalties (SPEC-5 Phase 29, later-life L2), reproducing
 * Medicare.gov's own 2026 worked examples.
 */
let data: BundledData;
let costs: MedicareCostsData;
beforeAll(async () => {
  data = await loadBundledData();
  await data.loadDeferred("medicare-costs-2026");
  costs = data.medicareCosts()!;
});

const none = { monthsLateB: 0, monthsLateD: 0, monthsLateA: 0, partAPremium: "none" as const };

describe("the three penalties", () => {
  it("reproduces Medicare.gov's Part D example: 14 months is $5.50", () => {
    // $38.99 × 0.14 = $5.46, "rounded to the nearest $0.10 = $5.50".
    const r = medicarePenalties({ ...none, monthsLateD: 14 }, costs);
    expect(r.partD.percent).toBeCloseTo(0.14, 10);
    expect(r.partD.monthly.toNumber()).toBe(5.5);
  });

  it("reproduces Medicare.gov's Part B example: two years is $40.58, $243.50 in all", () => {
    const r = medicarePenalties({ ...none, monthsLateB: 24 }, costs);
    expect(r.partB.monthly.toNumber()).toBe(40.58);
    expect(r.partB.premiumWithPenalty.toNumber()).toBe(243.5);
  });

  it("counts only full years for Part B: 23 months costs what 12 does", () => {
    expect(medicarePenalties({ ...none, monthsLateB: 11 }, costs).partB.monthly.toNumber()).toBe(0);
    expect(medicarePenalties({ ...none, monthsLateB: 23 }, costs).partB.monthly.toNumber()).toBe(
      20.29,
    );
  });

  it("charges bought Part A 10% for twice the full years late", () => {
    const r = medicarePenalties({ ...none, monthsLateA: 24, partAPremium: "full" }, costs);
    expect(r.partA.monthly.toNumber()).toBe(56.5);
    expect(r.partA.years).toBe(4);
    expect(medicarePenalties({ ...none, monthsLateA: 24 }, costs).partA.years).toBe(0);
  });
});

function mount(params: URLSearchParams, bundled: BundledData | null = data): HTMLElement {
  const root = document.createElement("div");
  mountMedicarePenalties({
    root,
    params,
    setParams: () => {},
    permalink: (p) => `https://enklayve.com/#/x?${(p ?? params).toString()}`,
    navigate: () => {},
    locale: "en-US",
    data: bundled,
    profile: new SituationStore(),
  } as TileContext);
  return root;
}

const CASE = new URLSearchParams({ b: "24", d: "14", y: "20" });

describe("Medicare Enrollment Penalties", () => {
  it("shows each penalty, the year, and the horizon at today's premiums, cited", () => {
    const root = mount(CASE);
    const text = root.textContent ?? "";
    expect(text).toContain("$40.58/mo");
    expect(text).toContain("$243.50/mo");
    expect(text).toContain("$5.50/mo");
    // ($40.58 + $5.50) × 12 × 20.
    expect(text).toContain("$11,059.20");
    expect(text).toContain("at today's premiums");
    expect(root.querySelectorAll("a.cite-link").length).toBeGreaterThanOrEqual(3);
  });

  it("renders the enrollment clocks, each with a source", () => {
    const deadlines = mount(CASE).querySelectorAll("[data-deadline]");
    expect(deadlines.length).toBe(3);
    for (const d of deadlines) expect(d.querySelector("a.cite-link")).not.toBeNull();
  });

  it("degrades to a banner, never a figure, when the costs are missing", () => {
    const root = mount(CASE, null);
    expect(root.querySelector(".verify-banner")).not.toBeNull();
    expect(root.textContent).not.toMatch(/\$\d/);
  });

  it("declares harm tier 2 with the advice line, and clears the gate", async () => {
    await medicarePenaltiesTile.loadHow!();
    expect(medicarePenaltiesTile.harmTier).toBe(2);
    expect(checkHarmTier([medicarePenaltiesTile as AuditTile])).toEqual([]);
  });

  it("has no axe violations", async () => {
    const root = mount(CASE);
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    root.remove();
    expect(results.violations).toEqual([]);
  });
});
