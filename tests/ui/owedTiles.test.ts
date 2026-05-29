import { describe, it, expect, beforeAll, afterEach } from "vitest";
import axe from "axe-core";
import { mountFpl } from "../../src/tiles/fpl";
import { mountEitc } from "../../src/tiles/eitc";
import { mountChildTaxCredit } from "../../src/tiles/childTaxCredit";
import { mountOwedScreener } from "../../src/tiles/owedScreener";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

/**
 * Pillar 2 — What You're Owed (BUILD-SPEC.md §4). Each tool computes from the
 * cited, bundled dataset; the screener composes them. Behavior is asserted on
 * the (synchronous) breakdown/list, not the animated headline.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(
  mountFn: (ctx: TileContext) => void,
  params: URLSearchParams,
  profile = new SituationStore(),
): HTMLElement {
  const root = document.createElement("div");
  mountFn({
    root,
    params,
    setParams: () => {},
    permalink: (p) => `https://enklayve.com/#/x?${(p ?? params).toString()}`,
    navigate: () => {},
    locale: "en-US",
    data,
    profile,
  });
  return root;
}

function rowValue(root: HTMLElement, labelStarts: string): string | undefined {
  const rows = Array.from(root.querySelectorAll(".bd-row"));
  const row = rows.find((r) =>
    (r.querySelector(".bd-label")?.textContent ?? "").startsWith(labelStarts),
  );
  return row?.querySelector(".bd-value")?.textContent ?? undefined;
}

afterEach(() => document.body.replaceChildren());

describe("Federal Poverty Level tile", () => {
  it("reports income as a percentage of the poverty line, cited", () => {
    const root = mount(mountFpl, new URLSearchParams({ hh: "4", inc: "62400" }));
    expect(rowValue(root, "Poverty line (100% FPL)")).toContain("$31,200");
    expect(rowValue(root, "Income as % of poverty line")).toBe("200%");
    expect(root.querySelector("a.cite-link")?.getAttribute("href")).toMatch(/hhs\.gov/);
  });
});

describe("EITC tile", () => {
  it("estimates a phased-out credit for one child at $30,000, cited", () => {
    const root = mount(mountEitc, new URLSearchParams({ inc: "30000", kids: "1" }));
    expect(rowValue(root, "Estimated EITC")).toContain("$3,0");
    expect(root.querySelector("a.cite-link")?.getAttribute("href")).toMatch(/irs\.gov/);
  });
});

describe("Child Tax Credit tile", () => {
  it("is $2,000 per child below the phaseout, with the refundable portion shown", () => {
    const root = mount(
      mountChildTaxCredit,
      new URLSearchParams({ kids: "2", inc: "120000", mfj: "1" }),
    );
    expect(rowValue(root, "Estimated Child Tax Credit")).toContain("$4,000");
    expect(rowValue(root, "Refundable portion")).toContain("$3,400");
  });
});

describe("What Am I Owed screener", () => {
  it("composes the programs a household likely qualifies for", () => {
    const root = mount(
      mountOwedScreener,
      new URLSearchParams({ hh: "4", inc: "38000", kids: "2", mfj: "1" }),
    );
    expect(root.querySelector(".screener-summary")?.textContent).toContain(
      "% of the federal poverty line",
    );
    const programs = Array.from(root.querySelectorAll(".screener-program")).map(
      (n) => n.textContent ?? "",
    );
    expect(programs).toContain("Earned Income Tax Credit");
    expect(programs).toContain("Child Tax Credit");
    // Every listed program carries a citation.
    expect(root.querySelectorAll(".screener-item a.cite-link").length).toBeGreaterThanOrEqual(2);
  });

  it("writes household size and income back to Your Situation on edit", () => {
    const profile = new SituationStore();
    const root = mount(mountOwedScreener, new URLSearchParams(), profile);
    const hh = root.querySelector<HTMLInputElement>('input[name="hh"]')!;
    hh.value = "3";
    hh.dispatchEvent(new Event("input"));
    const inc = root.querySelector<HTMLInputElement>('input[name="inc"]')!;
    inc.value = "40000";
    inc.dispatchEvent(new Event("input"));
    expect(profile.get("householdSize")).toBe(3);
    expect(profile.get("annualIncome")).toBe(40000);
  });
});

describe("Pillar 2 accessibility", () => {
  for (const tc of [
    { name: "fpl", mount: mountFpl, params: new URLSearchParams({ hh: "4", inc: "62400" }) },
    { name: "eitc", mount: mountEitc, params: new URLSearchParams({ inc: "30000", kids: "1" }) },
    {
      name: "ctc",
      mount: mountChildTaxCredit,
      params: new URLSearchParams({ kids: "2", inc: "120000", mfj: "1" }),
    },
    {
      name: "screener",
      mount: mountOwedScreener,
      params: new URLSearchParams({ hh: "4", inc: "38000", kids: "2" }),
    },
  ]) {
    it(`${tc.name} has no axe violations`, async () => {
      const root = mount(tc.mount, tc.params);
      document.body.append(root);
      const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
      expect(results.violations.map((v) => v.id).join(", ")).toBe("");
    }, 30000);
  }
});
