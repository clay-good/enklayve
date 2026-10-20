import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { applicablePercentage, compareDependentCare } from "../../src/engine/dependentCare";
import { mountDependentCare } from "../../src/tiles/dependentCareView";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { DependentCareData } from "../../src/data/schemas";
import type { TaxContext } from "../../src/engine/tax";
import type { TileContext } from "../../src/tiles/types";

/**
 * Child & Dependent Care: Credit or FSA? (SPEC-5 Phase 31, young-family F1),
 * against §21 and §129 as Pub. L. 119-21 rewrote them for 2026.
 */
let data: BundledData;
let rules: DependentCareData;
let ctx: TaxContext;
beforeAll(async () => {
  data = await loadBundledData();
  await data.loadDeferred("dependent-care-2026");
  rules = data.dependentCare()!;
  ctx = { federal: data.federal()!, fica: data.fica()! };
});

const base = {
  filingStatus: "married_jointly" as const,
  wages: 90000,
  lowerEarnerWages: 35000,
  spouseDeemedEarner: false,
  qualifyingIndividuals: 2,
  expenses: 12000,
};

describe("§21(a)(2)'s applicable percentage", () => {
  it("reproduces the statute on a joint return, both floors included", () => {
    expect(applicablePercentage(15000, true, rules)).toBe(50);
    // $28,000 over $15,000 is 14 steps of $2,000.
    expect(applicablePercentage(43000, true, rules)).toBe(36);
    expect(applicablePercentage(75000, true, rules)).toBe(35);
    expect(applicablePercentage(150000, true, rules)).toBe(35);
    // $60,000 over $150,000 is 15 steps of $4,000, down to the 20% floor.
    expect(applicablePercentage(210000, true, rules)).toBe(20);
    expect(applicablePercentage(500000, true, rules)).toBe(20);
  });

  it("counts a fraction of a step as a step, and uses $2,000 steps from $75,000 off a joint return", () => {
    expect(applicablePercentage(15001, true, rules)).toBe(49);
    // $25,000 over $75,000 is 12.5 steps, so 13: 35 - 13 = 22.
    expect(applicablePercentage(100000, false, rules)).toBe(22);
    expect(applicablePercentage(100000, true, rules)).toBe(35);
  });
});

describe("the two routes", () => {
  it("limits the credit to the federal income tax, and never pays it out", () => {
    const r = compareDependentCare({ ...base, wages: 30000, lowerEarnerWages: 12000 }, ctx, rules);
    expect(r.creditOnly.tentative.greaterThan(0)).toBe(true);
    expect(r.creditOnly.credit.toNumber()).toBe(r.creditOnly.liability.toNumber());
    expect(r.creditOnly.credit.greaterThan(r.creditOnly.tentative)).toBe(false);
  });

  it("caps the credit at $6,000 of care for two, at 35% for this household", () => {
    const r = compareDependentCare(base, ctx, rules);
    expect(r.creditOnly.creditable.toNumber()).toBe(6000);
    expect(r.creditOnly.percentage).toBe(35);
    expect(r.creditOnly.credit.toNumber()).toBe(2100);
  });

  it("takes the FSA off the credit's cap, and saves FICA at 7.65% of it", () => {
    const r = compareDependentCare(base, ctx, rules);
    expect(r.fsa.excluded.toNumber()).toBe(7500);
    // $6,000 cap less $7,500 excluded leaves nothing for the credit.
    expect(r.fsa.credit.creditable.toNumber()).toBe(0);
    expect(r.fsa.ficaSaving.toNumber()).toBe(573.75);
    // Under 2026's figures the FSA takes the whole bill up to $7,500, more
    // than either cap, so the FSA route never keeps any credit.
    for (const expenses of [2000, 6000, 20000])
      expect(
        compareDependentCare({ ...base, expenses }, ctx, rules).fsa.credit.credit.toNumber(),
      ).toBe(0);
    const small = compareDependentCare(
      { ...base, qualifyingIndividuals: 2, expenses: 7000, lowerEarnerWages: 5000 },
      ctx,
      rules,
    );
    // The lower earner's $5,000 limits both routes (§21(d), §129(b)).
    expect(small.fsa.excluded.toNumber()).toBe(5000);
    expect(small.creditOnly.creditable.toNumber()).toBe(5000);
  });

  it("deems a student spouse to earn $500 a month for two or more", () => {
    const r = compareDependentCare(
      { ...base, lowerEarnerWages: 0, spouseDeemedEarner: true },
      ctx,
      rules,
    );
    expect(r.creditOnly.creditable.toNumber()).toBe(6000);
    expect(
      compareDependentCare(
        { ...base, lowerEarnerWages: 0 },
        ctx,
        rules,
      ).creditOnly.creditable.toNumber(),
    ).toBe(0);
  });

  it("allows no credit on a separate return, and halves the FSA", () => {
    const r = compareDependentCare(
      { ...base, filingStatus: "married_separately", wages: 50000 },
      ctx,
      rules,
    );
    expect(r.creditAllowed).toBe(false);
    expect(r.creditOnly.credit.toNumber()).toBe(0);
    expect(r.fsa.excluded.toNumber()).toBe(3750);
  });
});

function mount(params: URLSearchParams, profile = new SituationStore()): HTMLElement {
  const root = document.createElement("div");
  mountDependentCare({
    root,
    params,
    setParams: () => {},
    permalink: (p) => `https://enklayve.com/#/x?${(p ?? params).toString()}`,
    navigate: () => {},
    locale: "en-US",
    data,
    profile,
  } as TileContext);
  return root;
}

describe("Child & Dependent Care: Credit or FSA?", () => {
  it("shows both routes, and cites the FICA saving through the FICA shard", () => {
    const root = mount(
      new URLSearchParams({
        fs: "married_jointly",
        w: "90000",
        lo: "35000",
        kids: "2",
        care: "12000",
        st: "TX",
      }),
    );
    const text = root.textContent ?? "";
    expect(text).toContain("Credit only: 35% of $6,000.00 of care");
    expect(text).toContain("FSA route in all");
    expect(text).toContain("never a refund");
    const ficaRow = Array.from(root.querySelectorAll(".bd-row")).find((r) =>
      (r.textContent ?? "").includes("Social Security and Medicare"),
    )!;
    expect(ficaRow.querySelector("a")?.getAttribute("href")).toBe(data.fica()!.citation.sourceUrl);
  });

  it("reads the care bill from My Situation and writes it back", () => {
    const profile = new SituationStore();
    profile.set("dependentCareExpensesAnnual", 4000);
    const root = mount(new URLSearchParams({ fs: "single", w: "50000", kids: "1" }), profile);
    const care = root.querySelector<HTMLInputElement>('input[name="care"]')!;
    expect(care.value).toBe("4000");
    care.value = "5000";
    care.dispatchEvent(new Event("input"));
    expect(profile.get("dependentCareExpensesAnnual")).toBe(5000);
  });

  it("has no axe violations", async () => {
    const root = mount(new URLSearchParams({ w: "90000", lo: "35000", kids: "2", care: "12000" }));
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    root.remove();
    expect(results.violations).toEqual([]);
  });
});
