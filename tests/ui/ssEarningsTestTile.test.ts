import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { earningsTest } from "../../src/engine/socialSecurity";
import { ssEarningsTestTile } from "../../src/tiles/ssEarningsTest";
import { mountSsEarningsTest } from "../../src/tiles/ssEarningsTestView";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import type { SsEarningsTestData } from "../../src/data/schemas";
import type { TileContext } from "../../src/tiles/types";

/** Social Security Earnings Test (SPEC-5 Phase 29, later-life L3), 2026's limits. */
let data: BundledData;
let rules: SsEarningsTestData;
beforeAll(async () => {
  data = await loadBundledData();
  await data.loadDeferred("ss-earnings-test-2026");
  rules = data.ssEarningsTest()!;
});

describe("the retirement earnings test", () => {
  it("reads 2026's limits from SSA's notice", () => {
    expect(rules.lowerAnnualExempt).toBe(24480);
    expect(rules.higherAnnualExempt).toBe(65160);
    expect(rules.citation.sourceUrl).toContain("federalregister.gov");
  });

  it("withholds $1 for $2 below the FRA year, in whole months", () => {
    // ($40,000 - $24,480) / 2 = $7,760, which takes 5 payments of $1,800.
    const r = earningsTest(
      { monthlyBenefit: 1800, stage: "before", earnings: 40000, months: 12 },
      rules,
    );
    expect(r.withheld.toNumber()).toBe(7760);
    expect(r.monthsWithheld).toBe(5);
    expect(r.paid.toNumber()).toBe(12600);
  });

  it("withholds $1 for $3 over the higher limit in the FRA year, from months before it", () => {
    // ($70,000 - $65,160) / 3 = $1,613.33: one payment of the six before FRA.
    const r = earningsTest(
      { monthlyBenefit: 1800, stage: "this-year", earnings: 70000, months: 6 },
      rules,
    );
    expect(r.withheld.toNumber()).toBe(1613.33);
    expect(r.monthsWithheld).toBe(1);
    expect(r.paid.toNumber()).toBe(9000);
  });

  it("holds back nothing at or under the limit, and never more months than there are", () => {
    expect(
      earningsTest({ monthlyBenefit: 1800, stage: "before", earnings: 24480, months: 12 }, rules)
        .monthsWithheld,
    ).toBe(0);
    expect(
      earningsTest({ monthlyBenefit: 500, stage: "before", earnings: 200000, months: 12 }, rules)
        .monthsWithheld,
    ).toBe(12);
  });
});

function mount(params: URLSearchParams, bundled: BundledData | null = data): HTMLElement {
  const root = document.createElement("div");
  mountSsEarningsTest({
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

describe("Social Security Earnings Test", () => {
  it("shows the amount, the whole months, and the credit at full retirement age", () => {
    const root = mount(new URLSearchParams({ ben: "1800", st: "before", earn: "40000" }));
    const text = root.textContent ?? "";
    expect(text).toContain("$7,760.00");
    expect(text).toContain("5 of 12 months");
    expect(text).toContain("are not lost");
    expect(root.querySelectorAll("a.cite-link").length).toBeGreaterThanOrEqual(2);
  });

  it("asks for the months before FRA only in the FRA year", () => {
    const before = mount(new URLSearchParams({ ben: "1800", st: "before", earn: "40000" }));
    expect(
      before.querySelector<HTMLInputElement>('input[name="mo"]')!.closest("[hidden]"),
    ).not.toBeNull();
    const fra = mount(
      new URLSearchParams({ ben: "1800", st: "this-year", earn: "70000", mo: "6" }),
    );
    expect(fra.textContent).toContain("1 of 6 months");
  });

  it("degrades to a banner, never a figure, when the limits are missing", () => {
    const root = mount(new URLSearchParams({ ben: "1800" }), null);
    expect(root.querySelector(".verify-banner")).not.toBeNull();
    expect(root.textContent).not.toMatch(/\$\d/);
  });

  it("declares harm tier 1 and clears the gate", () => {
    expect(ssEarningsTestTile.harmTier).toBe(1);
    expect(checkHarmTier([ssEarningsTestTile as AuditTile])).toEqual([]);
  });

  it("has no axe violations", async () => {
    const root = mount(new URLSearchParams({ ben: "1800", st: "before", earn: "40000" }));
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    root.remove();
    expect(results.violations).toEqual([]);
  });
});
