import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { spousalBenefit, survivorBenefit, survivorFraMonths } from "../../src/engine/ssFamily";
import { ssSpousalSurvivorTile } from "../../src/tiles/ssSpousalSurvivor";
import { mountSsSpousalSurvivor } from "../../src/tiles/ssSpousalSurvivorView";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import type { SsFamilyBenefitsData } from "../../src/data/schemas";
import type { TileContext } from "../../src/tiles/types";

/**
 * Spousal and Survivor Benefits (SPEC-5 Phase 29, later-life L4), reproducing
 * 20 CFR §404.410's own examples.
 */
let data: BundledData;
let rules: SsFamilyBenefitsData;
beforeAll(async () => {
  data = await loadBundledData();
  await data.loadDeferred("ss-family-benefits-2026");
  rules = data.ssFamilyBenefits()!;
});

describe("spousal and survivor reductions", () => {
  it("reproduces §404.410(b): $412.40 for 28 months is reduced $80.20 to $332.20", () => {
    // Full retirement age 65 and 4 months (784), claiming at 63 (756).
    const r = spousalBenefit(824.8, 784, 756, rules);
    expect(r.unreduced.toNumber()).toBe(412.4);
    expect(r.monthsEarly).toBe(28);
    expect(r.reduction.toNumber()).toBe(80.2);
    expect(r.monthly.toNumber()).toBe(332.2);
  });

  it("pays half the PIA at full retirement age, and 75% of it 36 months early", () => {
    expect(spousalBenefit(1600, 804, 804, rules).monthly.toNumber()).toBe(800);
    // SSA's own example: a $1,600 PIA, 36 months early, $600.
    expect(spousalBenefit(1600, 804, 768, rules).monthly.toNumber()).toBe(600);
  });

  it("reproduces §404.410(c)(1): $785.70 at 64 is reduced $56.00 to $729.70", () => {
    const r = survivorBenefit(785.7, 784, 768, rules);
    expect(r.monthsEarly).toBe(16);
    expect(r.reduction.toNumber()).toBe(56);
    expect(r.monthly.toNumber()).toBe(729.7);
  });

  it("floors a survivor at 71.5% at 60, by the survivor's own FRA table", () => {
    expect(survivorFraMonths(1956, rules)).toBe(792);
    expect(survivorFraMonths(1960, rules)).toBe(800);
    expect(survivorFraMonths(1962, rules)).toBe(804);
    // $2,000 × 0.285 = $570.00 off at 60.
    expect(survivorBenefit(2000, 804, 720, rules).monthly.toNumber()).toBe(1430);
    expect(survivorBenefit(2000, 804, 804, rules).monthly.toNumber()).toBe(2000);
  });
});

function mount(params: URLSearchParams, bundled: BundledData | null = data): HTMLElement {
  const root = document.createElement("div");
  mountSsSpousalSurvivor({
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

describe("Spousal and Survivor Benefits", () => {
  it("shows the spousal amount, the own record beside it, and three survivor ages", () => {
    const root = mount(new URLSearchParams({ wpia: "1600", opia: "500", born: "1962", age: "67" }));
    const text = root.textContent ?? "";
    expect(text).toContain("$800.00/mo");
    expect(text).toContain("The spousal amount pays more");
    expect(text).toContain("$1,144.00/mo");
    expect(text).toContain("$1,600.00/mo");
    expect(root.querySelectorAll("a.cite-link").length).toBeGreaterThanOrEqual(3);
  });

  it("starts from the birth year My Situation holds", () => {
    const profile = new SituationStore();
    profile.set("birthYear", 1960);
    const root = document.createElement("div");
    mountSsSpousalSurvivor({
      root,
      params: new URLSearchParams({ wpia: "2000" }),
      setParams: () => {},
      permalink: () => "",
      navigate: () => {},
      locale: "en-US",
      data,
      profile,
    } as TileContext);
    expect(root.querySelector<HTMLInputElement>('input[name="born"]')?.value).toBe("1960");
  });

  it("degrades to a banner, never a figure, when the rules are missing", () => {
    const root = mount(new URLSearchParams({ wpia: "1600" }), null);
    expect(root.querySelector(".verify-banner")).not.toBeNull();
    expect(root.textContent).not.toMatch(/\$\d/);
  });

  it("declares harm tier 1 and clears the gate", () => {
    expect(ssSpousalSurvivorTile.harmTier).toBe(1);
    expect(checkHarmTier([ssSpousalSurvivorTile as AuditTile])).toEqual([]);
  });

  it("has no axe violations", async () => {
    const root = mount(new URLSearchParams({ wpia: "1600", opia: "500", born: "1962", age: "67" }));
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    root.remove();
    expect(results.violations).toEqual([]);
  });
});
