import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { homeSaleGain, type HomeSaleInput } from "../../src/engine/homeSale";
import { estimateCapitalGains } from "../../src/engine/capitalGains";
import { homeSaleGainTile } from "../../src/tiles/homeSaleGain";
import { mountHomeSaleGain } from "../../src/tiles/homeSaleGainView";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import type { HomeSaleExclusionData } from "../../src/data/schemas";
import type { TileContext } from "../../src/tiles/types";

/** Selling a Home: the Taxable Gain (SPEC-5 Phase 28), from IRC §121. */
let data: BundledData;
let rules: HomeSaleExclusionData;
beforeAll(async () => {
  data = await loadBundledData();
  await data.loadDeferred("home-sale-exclusion-2026");
  rules = data.homeSaleExclusion()!;
});

const BASE: HomeSaleInput = {
  joint: false,
  salePrice: 600000,
  sellingCosts: 36000,
  basis: 300000,
  monthsOwned: 60,
  monthsLived: 60,
  monthsSincePriorExclusion: null,
  qualifyingReason: false,
};

describe("IRC §121", () => {
  it("reads its limits from the cited shard", () => {
    expect(rules.maxExclusion).toBe(250000);
    expect(rules.maxExclusionJoint).toBe(500000);
    expect(rules.ownershipAndUseMonths).toBe(24);
    expect(rules.citation.sourceUrl).toContain("/26/121");
  });

  it("excludes up to $250,000 after two of five years, and taxes the rest", () => {
    // $600,000 - $36,000 - $300,000 = $264,000; $14,000 is left.
    const r = homeSaleGain(BASE, rules);
    expect(r.gain.toNumber()).toBe(264000);
    expect(r.basis).toBe("full");
    expect(r.excluded.toNumber()).toBe(250000);
    expect(r.taxableGain.toNumber()).toBe(14000);
    expect(r.longTerm).toBe(true);
  });

  it("doubles the limit on a joint return", () => {
    const r = homeSaleGain({ ...BASE, joint: true }, rules);
    expect(r.limit.toNumber()).toBe(500000);
    expect(r.taxableGain.toNumber()).toBe(0);
  });

  it("keeps a share for a job move: 18 of 24 months is three quarters", () => {
    // Joint, $400,000 of gain, 18 months: 0.75 × $500,000 = $375,000.
    const r = homeSaleGain(
      {
        ...BASE,
        joint: true,
        salePrice: 800000,
        sellingCosts: 0,
        basis: 400000,
        monthsOwned: 18,
        monthsLived: 18,
        qualifyingReason: true,
      },
      rules,
    );
    expect(r.basis).toBe("partial");
    expect(r.share).toBe(0.75);
    expect(r.limit.toNumber()).toBe(375000);
    expect(r.taxableGain.toNumber()).toBe(25000);
    expect(r.longTerm).toBe(true);
  });

  it("measures a partial share by the time since the last excluded sale when shorter", () => {
    const r = homeSaleGain(
      { ...BASE, monthsSincePriorExclusion: 6, qualifyingReason: true },
      rules,
    );
    // Owned and lived 60 months, but the last excluded sale was 6 months ago.
    expect(r.share).toBe(0.25);
    expect(r.limit.toNumber()).toBe(62500);
  });

  it("gives no exclusion short of the tests without a qualifying reason", () => {
    const r = homeSaleGain({ ...BASE, monthsOwned: 12, monthsLived: 12 }, rules);
    expect(r.basis).toBe("none");
    expect(r.excluded.toNumber()).toBe(0);
    expect(r.shortOf).toEqual([
      "owned it fewer than 24 months of the last 60",
      "lived in it fewer than 24 months of the last 60",
    ]);
    // A year or less is a short-term gain.
    expect(r.longTerm).toBe(false);
    const twice = homeSaleGain({ ...BASE, monthsSincePriorExclusion: 23 }, rules);
    expect(twice.basis).toBe("none");
    expect(homeSaleGain({ ...BASE, monthsSincePriorExclusion: 24 }, rules).basis).toBe("full");
  });

  it("never reports a gain on a sale at a loss", () => {
    const r = homeSaleGain({ ...BASE, salePrice: 250000 }, rules);
    expect(r.gain.toNumber()).toBe(0);
    expect(r.taxableGain.toNumber()).toBe(0);
  });
});

function mount(params: URLSearchParams, bundled: BundledData | null = data): HTMLElement {
  const root = document.createElement("div");
  mountHomeSaleGain({
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

const EXAMPLE = new URLSearchParams({
  fs: "single",
  sp: "600000",
  sc: "36000",
  b: "300000",
  own: "60",
  use: "60",
  oth: "80000",
});

describe("Selling a Home: the Taxable Gain", () => {
  it("taxes what is left through the capital-gains engine, cited to its shard", () => {
    const root = mount(EXAMPLE);
    const want = estimateCapitalGains(
      {
        filingStatus: "single",
        ordinaryTaxableIncome: 80000,
        shortTermGain: 0,
        longTermGain: 14000,
        modifiedAgi: 94000,
      },
      data.federal()!,
      data.capitalGains()!,
    );
    const text = root.textContent ?? "";
    expect(text).toContain("$14,000.00");
    expect(text).toContain(want.longTermTax.format("en-US"));
    const sources = [...root.querySelectorAll("a.cite-link")].map((a) => a.getAttribute("href"));
    expect(sources).toContain(data.capitalGains()!.citation.sourceUrl);
    expect(sources).toContain(rules.citation.sourceUrl);
  });

  it("says what is short, and points to the partial exclusion", () => {
    const text =
      mount(new URLSearchParams({ ...Object.fromEntries(EXAMPLE), own: "12", use: "12" }))
        .textContent ?? "";
    expect(text).toContain("No exclusion applies, because you owned it fewer than 24 months");
    expect(text).toContain("a share of the exclusion may still apply");
  });

  it("degrades to a banner, never a figure, when the rules are missing", () => {
    const root = mount(EXAMPLE, null);
    expect(root.querySelector(".verify-banner")).not.toBeNull();
    expect(root.textContent).not.toMatch(/\$\d/);
  });

  it("declares harm tier 1 and clears the gate", () => {
    expect(homeSaleGainTile.harmTier).toBe(1);
    expect(checkHarmTier([homeSaleGainTile as AuditTile])).toEqual([]);
  });

  it("has no axe violations", async () => {
    const root = mount(EXAMPLE);
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    root.remove();
    expect(results.violations).toEqual([]);
  });
});
