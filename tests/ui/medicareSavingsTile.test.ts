import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { medicareSavingsScreen } from "../../src/engine/medicareSavings";
import { medicareSavingsTile } from "../../src/tiles/medicareSavings";
import { mountMedicareSavings } from "../../src/tiles/medicareSavingsView";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import type { MedicareSavingsData } from "../../src/data/schemas";
import type { TileContext } from "../../src/tiles/types";

/**
 * Medicare Savings Programs & Extra Help (SPEC-5 Phase 30, later-life L5),
 * against Medicare.gov's 2026 lines and CMS's 2026 Extra Help resource memo.
 */
let data: BundledData;
let rules: MedicareSavingsData;
beforeAll(async () => {
  data = await loadBundledData();
  await data.loadDeferred("medicare-savings-2026");
  rules = data.medicareSavings()!;
});

describe("the federal Medicare Savings and Extra Help lines", () => {
  it("reads 2026's lines from Medicare.gov and CMS", () => {
    expect(rules.programs.map((p) => [p.id, p.monthlyIncomeLine])).toEqual([
      ["qmb", { individual: 1350, couple: 1824 }],
      ["slmb", { individual: 1616, couple: 2184 }],
      ["qi", { individual: 1816, couple: 2455 }],
    ]);
    expect(rules.savingsResourceLimit).toEqual({ individual: 9950, couple: 14910 });
    expect(rules.extraHelp.annualIncomeLine).toEqual({ individual: 23940, couple: 32460 });
    expect(rules.extraHelp.resourceLimitWithBurial).toEqual({ individual: 18090, couple: 36100 });
  });

  it("puts the lines where they are, inclusive", () => {
    const at = (monthlyIncome: number, couple = false) =>
      medicareSavingsScreen({ couple, monthlyIncome, resources: 0 }, rules).programs.map(
        (p) => p.underIncomeLine,
      );
    expect(at(1350)).toEqual([true, true, true]);
    expect(at(1351)).toEqual([false, true, true]);
    expect(at(1816)).toEqual([false, false, true]);
    expect(at(1817)).toEqual([false, false, false]);
    expect(at(1824, true)).toEqual([true, true, true]);
  });

  it("compares a year's income with Extra Help, and tiers its savings test", () => {
    const r = (monthlyIncome: number, resources: number) =>
      medicareSavingsScreen({ couple: false, monthlyIncome, resources }, rules).extraHelp;
    expect(r(1995, 0).underIncomeLine).toBe(true); // $23,940 a year exactly
    expect(r(1995.01, 0).underIncomeLine).toBe(false);
    expect(r(0, 16590).resources).toBe("under");
    expect(r(0, 17000).resources).toBe("under-with-burial");
    expect(r(0, 18090.01).resources).toBe("over");
  });
});

function mount(params: URLSearchParams, bundled: BundledData | null = data): HTMLElement {
  const root = document.createElement("div");
  mountMedicareSavings({
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

describe("Medicare Savings Programs & Extra Help", () => {
  it("never says who qualifies, at any income, and names who decides", () => {
    for (const params of [
      new URLSearchParams({ inc: "900" }),
      new URLSearchParams({ inc: "5000", res: "90000" }),
      new URLSearchParams({ inc: "1700", res: "17000", cpl: "1" }),
    ]) {
      const text = (mount(params).textContent ?? "").toLowerCase();
      expect(text).not.toContain("you qualify");
      expect(text).not.toContain("you are eligible");
      expect(text).not.toContain("you do not qualify");
      expect(text).toContain("only your state medicaid agency and social security decide");
    }
  });

  it("puts the state caveat above every federal figure", () => {
    const root = mount(new URLSearchParams({ inc: "1500", res: "6000" }));
    const note = root.querySelector(".msp-state")!;
    for (const figure of root.querySelectorAll(".msp-resources, .msp-row")) {
      expect(note.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(root.textContent).toContain("$1,616");
    expect(root.textContent).toContain("likely worth applying for");
  });

  it("degrades to a banner, never a figure, when the limits are missing", () => {
    const root = mount(new URLSearchParams({ inc: "1500" }), null);
    expect(root.querySelector(".verify-banner")).not.toBeNull();
    expect(root.textContent).not.toMatch(/\$\d/);
  });

  it("declares harm tier 3 with channels and the advice line", async () => {
    await medicareSavingsTile.loadHow!();
    expect(medicareSavingsTile.harmTier).toBe(3);
    expect(medicareSavingsTile.channels!.length).toBe(3);
    expect(checkHarmTier([medicareSavingsTile as AuditTile])).toEqual([]);
  });

  it("has no axe violations", async () => {
    const root = mount(new URLSearchParams({ inc: "1500", res: "6000" }));
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    root.remove();
    expect(results.violations).toEqual([]);
  });
});
