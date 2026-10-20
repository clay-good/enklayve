import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { ssiEstimate } from "../../src/engine/ssi";
import { ssiEstimateTile } from "../../src/tiles/ssiEstimate";
import { mountSsiEstimate } from "../../src/tiles/ssiEstimateView";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import type { SsiData } from "../../src/data/schemas";
import type { TileContext } from "../../src/tiles/types";

/**
 * SSI Estimate (SPEC-5 Phase 30, later-life L6), worked by hand in the
 * regulations' order of exclusions (20 CFR §§416.1112, 416.1124).
 */
let data: BundledData;
let rules: SsiData;
beforeAll(async () => {
  data = await loadBundledData();
  await data.loadDeferred("ssi-2026");
  rules = data.ssi()!;
});

const none = { couple: false, earned: 0, unearned: 0, student: false, resources: 0 };

describe("the federal SSI payment", () => {
  it("reads 2026's rates from SSA's notice", () => {
    expect(rules.federalBenefitRate).toEqual({ individual: 994, couple: 1491 });
    expect(rules.resourceLimit).toEqual({ individual: 2000, couple: 3000 });
  });

  it("counts $500 of earnings as $207.50: $20, then $65, then half", () => {
    // ($500 - $20 - $65) / 2 = $207.50; $994 - $207.50 = $786.50.
    const r = ssiEstimate({ ...none, earned: 500 }, rules);
    expect(r.countableEarned.toNumber()).toBe(207.5);
    expect(r.payment.toNumber()).toBe(786.5);
  });

  it("takes the $20 from other income first, and counts the rest in full", () => {
    // $600 of Social Security counts as $580: $994 - $580 = $414.
    const r = ssiEstimate({ ...none, unearned: 600 }, rules);
    expect(r.countableUnearned.toNumber()).toBe(580);
    expect(r.payment.toNumber()).toBe(414);
    // With both, the $20 is used up on the other income: ($500 - $65) / 2.
    const both = ssiEstimate({ ...none, unearned: 600, earned: 500 }, rules);
    expect(both.countableEarned.toNumber()).toBe(217.5);
  });

  it("excludes a student's earnings first, and pays a couple's rate", () => {
    expect(
      ssiEstimate({ ...none, earned: 2000, student: true }, rules).countableEarned.toNumber(),
    ).toBe(0);
    expect(ssiEstimate({ ...none, couple: true }, rules).payment.toNumber()).toBe(1491);
  });

  it("flags resources over the limit", () => {
    expect(ssiEstimate({ ...none, resources: 2000 }, rules).overResourceLimit).toBe(false);
    expect(ssiEstimate({ ...none, resources: 2000.01 }, rules).overResourceLimit).toBe(true);
  });
});

function mount(params: URLSearchParams, bundled: BundledData | null = data): HTMLElement {
  const root = document.createElement("div");
  mountSsiEstimate({
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

describe("SSI Estimate", () => {
  it("never says who qualifies, at any income, and names who decides", () => {
    for (const params of [
      new URLSearchParams({ earn: "500" }),
      new URLSearchParams({ other: "5000" }),
      new URLSearchParams({ res: "90000" }),
    ]) {
      const text = (mount(params).textContent ?? "").toLowerCase();
      expect(text).not.toContain("you qualify");
      expect(text).not.toContain("you are eligible");
      expect(text).not.toContain("you do not qualify");
      expect(text).toContain("only social security decides");
    }
  });

  it("puts the state caveat above the figure", () => {
    const root = mount(new URLSearchParams({ earn: "500" }));
    const note = root.querySelector(".ssi-state")!;
    const card = root.querySelector(".tile-result")!.children[1]!;
    expect(note.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(root.textContent).toContain("$207.50/mo");
  });

  it("degrades to a banner, never a figure, when the amounts are missing", () => {
    const root = mount(new URLSearchParams({ earn: "500" }), null);
    expect(root.querySelector(".verify-banner")).not.toBeNull();
    expect(root.textContent).not.toMatch(/\$\d/);
  });

  it("declares harm tier 3 with channels and the advice line", async () => {
    await ssiEstimateTile.loadHow!();
    expect(ssiEstimateTile.harmTier).toBe(3);
    expect(ssiEstimateTile.channels!.length).toBeGreaterThan(0);
    expect(checkHarmTier([ssiEstimateTile as AuditTile])).toEqual([]);
  });

  it("has no axe violations", async () => {
    const root = mount(new URLSearchParams({ earn: "500", res: "800" }));
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    root.remove();
    expect(results.violations).toEqual([]);
  });
});
