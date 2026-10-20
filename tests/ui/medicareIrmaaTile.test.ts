import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { irmaaFor } from "../../src/engine/medicare";
import { medicareIrmaaTile } from "../../src/tiles/medicareIrmaa";
import { mountMedicareIrmaa } from "../../src/tiles/medicareIrmaaView";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import { TILES } from "../../src/tiles/registry";
import type { MedicareCostsData } from "../../src/data/schemas";
import type { TileContext } from "../../src/tiles/types";

/**
 * Medicare Premiums & IRMAA (SPEC-5 Phase 29, later-life L1), against CMS's
 * 2026 fact sheet: a cliff at every line, so each is tested at the line and a
 * cent past it.
 */
let data: BundledData;
let costs: MedicareCostsData;
beforeAll(async () => {
  data = await loadBundledData();
  await data.loadDeferred("medicare-costs-2026");
  costs = data.medicareCosts()!;
});

describe("the 2026 IRMAA tiers", () => {
  it("reads the standard premium and deductible from CMS", () => {
    expect(costs.partB.standardMonthly).toBe(202.9);
    expect(costs.partB.annualDeductible).toBe(283);
    expect(costs.irmaa.lookbackYears).toBe(2);
  });

  it("keeps $109,000 single at the standard premium, and moves a cent over", () => {
    expect(irmaaFor(109000, "single", costs).tierIndex).toBe(0);
    const over = irmaaFor(109000.01, "single", costs);
    expect(over.tierIndex).toBe(1);
    expect(over.partBMonthly.toNumber()).toBe(284.1);
    expect(over.partDMonthly.toNumber()).toBe(14.5);
    // ($284.10 + $14.50 - $202.90) × 12.
    expect(over.surchargeYearlyOne.toNumber()).toBe(1148.4);
  });

  it("uses the joint lines on a joint return", () => {
    expect(irmaaFor(218000, "married_jointly", costs).tierIndex).toBe(0);
    expect(irmaaFor(218000.01, "married_jointly", costs).partBMonthly.toNumber()).toBe(284.1);
    expect(irmaaFor(342000.01, "married_jointly", costs).partBMonthly.toNumber()).toBe(527.5);
  });

  it("starts the top tier at, not above, $500,000 single and $750,000 joint", () => {
    expect(irmaaFor(499999.99, "single", costs).partBMonthly.toNumber()).toBe(649.2);
    expect(irmaaFor(500000, "single", costs).partBMonthly.toNumber()).toBe(689.9);
    expect(irmaaFor(750000, "married_jointly", costs).partDMonthly.toNumber()).toBe(91);
  });

  it("gives a separate return its own two lines", () => {
    expect(irmaaFor(109000.01, "married_separately", costs).partBMonthly.toNumber()).toBe(649.2);
    expect(irmaaFor(391000, "married_separately", costs).partBMonthly.toNumber()).toBe(689.9);
    // Head of household files on the individual schedule.
    expect(irmaaFor(150000, "head_of_household", costs).partBMonthly.toNumber()).toBe(405.8);
  });

  it("says exactly how much room is left before the next line", () => {
    expect(irmaaFor(100000, "single", costs).next?.room.toNumber()).toBe(9000);
    // An inclusive line leaves a cent less.
    expect(irmaaFor(499000, "single", costs).next?.room.toNumber()).toBe(999.99);
    expect(irmaaFor(600000, "single", costs).next).toBeNull();
  });
});

function mount(params: URLSearchParams, bundled: BundledData | null = data): HTMLElement {
  const root = document.createElement("div");
  mountMedicareIrmaa({
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

const COUPLE = new URLSearchParams({ fs: "married_jointly", magi: "230000", both: "1" });

describe("Medicare Premiums & IRMAA", () => {
  it("shows the tier, both parts, the couple's year and the room, each cited", () => {
    const root = mount(COUPLE);
    const text = root.textContent ?? "";
    expect(text).toContain("$284.10/mo");
    expect(text).toContain("$14.50/mo");
    // ($284.10 + $14.50) × 12 × 2.
    expect(text).toContain("$7,166.40");
    expect(text).toContain("$44,000.00 of room");
    expect(text).toContain("Your 2026 premium is set by your 2024 return");
    expect(root.querySelectorAll("a.cite-link").length).toBeGreaterThanOrEqual(4);
  });

  it("names Form SSA-44 and renders the reconsideration window", () => {
    const root = mount(COUPLE);
    expect(root.querySelector('a[href*="ssa-44"]')).not.toBeNull();
    const deadline = root.querySelector("[data-deadline]");
    expect(deadline?.textContent).toContain("reconsider");
    expect(deadline?.querySelector("a.cite-link")?.getAttribute("href")).toContain("part-418");
  });

  it("degrades to a banner, never a figure, when the costs are missing", () => {
    const root = mount(COUPLE, null);
    expect(root.querySelector(".verify-banner")).not.toBeNull();
    expect(root.textContent).not.toMatch(/\$\d/);
  });

  it("opens the Medicare & Later Life hub, the thirteenth and last", () => {
    const hub = TILES.find((t) => t.id === "medicare-later-life");
    expect(hub?.title).toBe("Medicare & Later Life");
    expect(TILES.length).toBe(13);
    expect(medicareIrmaaTile.harmTier).toBe(1);
    expect(checkHarmTier([medicareIrmaaTile as AuditTile])).toEqual([]);
  });

  it("has no axe violations", async () => {
    const root = mount(COUPLE);
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    root.remove();
    expect(results.violations).toEqual([]);
  });
});
