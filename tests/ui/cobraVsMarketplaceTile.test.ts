import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { cobraVsMarketplace, type CobraInput } from "../../src/engine/cobra";
import { estimatePremiumTaxCredit } from "../../src/engine/benefits";
import { cobraVsMarketplaceTile } from "../../src/tiles/cobraVsMarketplace";
import { mountCobraVsMarketplace } from "../../src/tiles/cobraVsMarketplaceView";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import type { SeparationRulesData } from "../../src/data/schemas";
import type { TileContext } from "../../src/tiles/types";

/** COBRA or the Marketplace? (SPEC-5 Phase 28, layoff-month J2). */
let data: BundledData;
let rules: SeparationRulesData;
beforeAll(async () => {
  data = await loadBundledData();
  await data.loadDeferred("separation-rules-2026");
  rules = data.separationRules()!;
});

const BASE: CobraInput = {
  cobraMonthly: 600,
  planFullCostMonthly: 0,
  disabilityExtension: false,
  householdSize: 1,
  projectedAnnualIncome: 32000,
  benchmarkMonthly: 700,
};

const compare = (input: CobraInput) =>
  cobraVsMarketplace(input, rules, data.aca()!, data.fpl("contiguous")!);

describe("COBRA against the Marketplace", () => {
  it("reads the ceilings from the cited statute", () => {
    expect(rules.cobraPremiumCeiling).toBe(1.02);
    expect(rules.cobraDisabilityExtensionCeiling).toBe(1.5);
    expect(rules.citation.sourceUrl).toContain("/29/1162");
  });

  it("lets the credit flip the answer", () => {
    // Without a credit the $700 benchmark costs more than $600 of COBRA; at a
    // year's income low enough for one, the Marketplace costs less.
    const high = compare({ ...BASE, projectedAnnualIncome: 90000 });
    expect(high.credit.annualCredit.toNumber()).toBe(0);
    expect(high.monthlySavingOnMarketplace.toNumber()).toBe(-100);
    const low = compare(BASE);
    expect(low.credit.eligible).toBe(true);
    expect(low.monthlySavingOnMarketplace.toNumber()).toBeGreaterThan(0);
  });

  it("prices the Marketplace through the same credit the credit calculator computes", () => {
    const want = estimatePremiumTaxCredit(
      { householdSize: 1, annualIncome: 32000, benchmarkMonthlyPremium: 700 },
      data.aca()!,
      data.fpl("contiguous")!,
    );
    const r = compare(BASE);
    expect(r.marketplaceMonthly.toNumber()).toBe(
      Math.round((700 - want.monthlyCredit.toNumber()) * 100) / 100,
    );
    // A year of COBRA less a year of the benchmark plus the year's credit.
    expect(r.annualSavingOnMarketplace.toNumber()).toBe(
      Math.round((600 * 12 - 700 * 12 + want.annualCredit.toNumber()) * 100) / 100,
    );
  });

  it("checks the notice against 102% of the plan's cost, or 150% on the extension", () => {
    const over = compare({ ...BASE, planFullCostMonthly: 500 });
    expect(over.ceilingMonthly?.toNumber()).toBe(510);
    expect(over.overCeiling).toBe(true);
    const extension = compare({ ...BASE, planFullCostMonthly: 500, disabilityExtension: true });
    expect(extension.ceilingMonthly?.toNumber()).toBe(750);
    expect(extension.overCeiling).toBe(false);
    expect(compare(BASE).ceilingMonthly).toBeNull();
  });
});

function mount(params: URLSearchParams, bundled: BundledData | null = data): HTMLElement {
  const root = document.createElement("div");
  mountCobraVsMarketplace({
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

const CASE = new URLSearchParams({
  cob: "600",
  size: "1",
  inc: "32000",
  bm: "700",
  st: "OH",
  end: "2026-10-01",
});

describe("COBRA or the Marketplace?", () => {
  it("names the cheaper one and cites the credit to the ACA shard", () => {
    const root = mount(CASE);
    expect(root.textContent).toContain("The Marketplace costs less each month by");
    const sources = [...root.querySelectorAll("a.cite-link")].map((a) => a.getAttribute("href"));
    expect(sources).toContain(data.aca()!.citation.sourceUrl);
  });

  it("renders the election, first-premium and Marketplace clocks, and Part B when over 65", () => {
    const three = mount(CASE).querySelectorAll("[data-deadline]");
    expect(three.length).toBe(3);
    const four = mount(new URLSearchParams({ ...Object.fromEntries(CASE), 65: "1" }));
    expect(four.querySelectorAll("[data-deadline]").length).toBe(4);
    for (const d of four.querySelectorAll("[data-deadline]"))
      expect(d.querySelector("a.cite-link")).not.toBeNull();
  });

  it("states the one-way door and what it does not compare", () => {
    const text = mount(CASE).textContent ?? "";
    expect(text).toContain(
      "Dropping it early on purpose does not open a Marketplace enrollment window",
    );
    expect(text).toContain("Electing COBRA does not pause the Medicare Part B clock");
    expect(text).toContain("This compares premiums only");
  });

  it("flags a premium over the legal ceiling", () => {
    const root = mount(new URLSearchParams({ ...Object.fromEntries(CASE), full: "500" }));
    expect(root.textContent).toContain("more than the law allows");
  });

  it("asks for both prices before comparing, and degrades to a banner without rules", () => {
    expect(mount(new URLSearchParams()).textContent).toContain("Enter the COBRA premium");
    const root = mount(CASE, null);
    expect(root.querySelector(".verify-banner")).not.toBeNull();
    expect(root.textContent).not.toMatch(/\$\d/);
  });

  it("declares harm tier 2 with the advice line, and clears the gate", () => {
    expect(cobraVsMarketplaceTile.harmTier).toBe(2);
    expect(checkHarmTier([cobraVsMarketplaceTile as AuditTile])).toEqual([]);
  });

  it("is what the job-loss sequence's COBRA step opens", () => {
    const seq = data.lifeEvents()!.sequences.find((s) => s.id === "job-loss")!;
    expect(seq.steps.find((s) => s.id === "cobra-decide")?.tileId).toBe("cobra-vs-marketplace");
  });

  it("has no axe violations", async () => {
    const root = mount(CASE);
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    root.remove();
    expect(results.violations).toEqual([]);
  });
});
