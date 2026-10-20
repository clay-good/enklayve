import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { resourcesAt, type CliffData, type CliffInput } from "../../src/engine/cliffs";
import { secondIncome } from "../../src/engine/secondIncome";
import { mountSecondIncome } from "../../src/tiles/secondIncomeView";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

/**
 * Is the Second Income Worth It? (SPEC-5 Phase 31, young-family F3): the
 * cliff engine from one income to two, less childcare, plus the care credit
 * or FSA priced inside the same model.
 */
let data: BundledData;
let cliff: CliffData;
beforeAll(async () => {
  data = await loadBundledData();
  await data.loadDeferred("dependent-care-2026");
  cliff = {
    tax: { federal: data.federal()!, fica: data.fica()! },
    fpl: data.fpl("contiguous"),
    eitcCtc: data.eitcCtc(),
    aca: data.aca(),
    snap: data.snap(),
    medicaid: data.medicaid(),
    snapRegionSupported: true,
  };
});

const family: CliffInput = {
  filingStatus: "married_jointly",
  householdSize: 4,
  qualifyingChildren: 2,
  stateCode: "",
  benchmarkMonthlyPremium: 0,
};

describe("the second income", () => {
  it("can leave a family worse off after childcare and SNAP's gross-income test", () => {
    // $28,000 now and $18,000 more. Four people's 2026 poverty line is $33,000,
    // so SNAP's 130% gross test is $3,575 a month; $46,000 is $3,833, so the
    // second job ends SNAP outright.
    const before = resourcesAt(28000, family, cliff);
    const after = resourcesAt(46000, family, cliff);
    expect(before.snapAllotment).toBeGreaterThan(0);
    expect(after.snapAllotment).toBe(0);
    const r = secondIncome(
      { firstIncome: 28000, secondIncome: 18000, careAnnual: 14000, workCostsMonthly: 0 },
      family,
      cliff,
      data.dependentCare(),
    );
    // The resources gained, less $14,000 of care, plus the FSA: $7,500 out of
    // pay lowers tax and FICA and raises the EITC, with SNAP held at the full
    // wages. The credit is worth less here, because the federal income tax it
    // would cancel is already cancelled by the Child Tax Credit.
    const viaFsa =
      resourcesAt(38500, family, cliff).totalResources -
      resourcesAt(38500, family, cliff).snapAllotment +
      7500 -
      after.totalResources;
    expect(r.careRoute).toBe("fsa");
    expect(r.careRelief).toBeCloseTo(viaFsa, 6);
    expect(r.netGain).toBeCloseTo(after.totalResources - before.totalResources - 14000 + viaFsa, 2);
    expect(r.netGain).toBeLessThan(0);
    expect(r.effectiveRate).toBeGreaterThan(1);
  });

  it("names childcare subsidies first among what it leaves out", () => {
    const r = secondIncome(
      { firstIncome: 28000, secondIncome: 18000, careAnnual: 14000, workCostsMonthly: 0 },
      family,
      cliff,
      data.dependentCare(),
    );
    expect(r.unmodeled[0]).toMatch(/^Childcare subsidies/);
  });

  it("subtracts the costs of working, a month at a time", () => {
    const at = (cost: number) =>
      secondIncome(
        { firstIncome: 60000, secondIncome: 40000, careAnnual: 0, workCostsMonthly: cost },
        family,
        cliff,
        null,
      ).netGain;
    expect(at(0) - at(200)).toBeCloseTo(2400, 2);
  });
});

function mount(params: URLSearchParams, profile = new SituationStore()): HTMLElement {
  const root = document.createElement("div");
  mountSecondIncome({
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

describe("Is the Second Income Worth It?", () => {
  it("reports losing Medicaid as a coverage change, never as a dollar amount", () => {
    const root = mount(
      new URLSearchParams({
        fs: "married_jointly",
        st: "ca",
        size: "4",
        kids: "2",
        inc: "30000",
        sec: "20000",
        care: "8000",
      }),
    );
    const row = Array.from(root.querySelectorAll(".bd-row")).find((r) =>
      r.querySelector(".bd-label")?.textContent?.includes("Medicaid"),
    );
    expect(row).toBeDefined();
    const value = row!.querySelector(".bd-value")?.textContent ?? "";
    expect(value).toContain("not priced");
    expect(value).not.toMatch(/\$[\d,]+/);
  });

  it("says when the job leaves the household worse off, and shows the rate past 100%", () => {
    const root = mount(
      new URLSearchParams({
        fs: "married_jointly",
        st: "",
        size: "4",
        kids: "2",
        inc: "28000",
        sec: "18000",
        care: "14000",
      }),
    );
    expect(root.querySelector(".verify-banner")?.textContent).toContain("worse off");
    expect(root.querySelector(".cliff-unmodeled li")?.textContent).toMatch(/^Childcare subsidies/);
  });

  it("shares the care bill with the dependent care tool through My Situation", () => {
    const profile = new SituationStore();
    profile.set("dependentCareExpensesAnnual", 9000);
    const root = mount(new URLSearchParams({ sec: "30000" }), profile);
    const care = root.querySelector<HTMLInputElement>('input[name="care"]')!;
    expect(care.value).toBe("9000");
    care.value = "10000";
    care.dispatchEvent(new Event("input"));
    expect(profile.get("dependentCareExpensesAnnual")).toBe(10000);
  });

  it("has no axe violations", async () => {
    const root = mount(new URLSearchParams({ inc: "42000", sec: "24000", care: "14000" }));
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    root.remove();
    expect(results.violations).toEqual([]);
  });
});
