import { describe, it, expect, beforeAll, afterEach } from "vitest";
import axe from "axe-core";
import { mountFpl } from "../../src/tiles/fpl";
import { mountEitc } from "../../src/tiles/eitc";
import { mountChildTaxCredit } from "../../src/tiles/childTaxCredit";
import { mountOwedScreener } from "../../src/tiles/owedScreener";
import { mountSaversCredit } from "../../src/tiles/saversCredit";
import { mountSnap } from "../../src/tiles/snap";
import { mountMedicaid } from "../../src/tiles/medicaid";
import { mountAcaPtc } from "../../src/tiles/acaPtc";
import { mountFafsaSai } from "../../src/tiles/fafsaSai";
import { mountPell } from "../../src/tiles/pell";
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

  it("includes a SNAP estimate for a low-income contiguous household", () => {
    const root = mount(
      mountOwedScreener,
      new URLSearchParams({ hh: "4", inc: "38000", kids: "2", mfj: "1" }),
    );
    const programs = Array.from(root.querySelectorAll(".screener-program")).map(
      (n) => n.textContent ?? "",
    );
    expect(programs).toContain("SNAP (food assistance)");
  });
});

describe("Saver's Credit tile", () => {
  it("gives the 50% credit below the AGI ceiling, cited", () => {
    const root = mount(
      mountSaversCredit,
      new URLSearchParams({ fs: "single", agi: "21000", c: "2000" }),
    );
    expect(rowValue(root, "Estimated Saver's Credit")).toContain("$1,000");
    expect(root.querySelector("a.cite-link")?.getAttribute("href")).toMatch(/irs\.gov/);
  });
});

describe("SNAP tile", () => {
  it("estimates a monthly benefit for an eligible household, cited", () => {
    const root = mount(mountSnap, new URLSearchParams({ hh: "3", inc: "2200" }));
    expect(rowValue(root, "Estimated monthly benefit")).toContain("$297");
    expect(root.querySelectorAll("a.cite-link").length).toBeGreaterThanOrEqual(2);
  });

  it("reports ineligibility above the gross income limit", () => {
    const root = mount(mountSnap, new URLSearchParams({ hh: "1", inc: "3000" }));
    expect(rowValue(root, "Estimated monthly benefit")).toContain("Not eligible");
  });
});

describe("Medicaid tile", () => {
  it("flags income eligibility in an expansion state, cited", () => {
    const root = mount(mountMedicaid, new URLSearchParams({ st: "CA", hh: "1", inc: "18000" }));
    expect(rowValue(root, "Medicaid expansion")).toContain("expanded Medicaid");
    expect(rowValue(root, "Likely eligible")).toContain("Yes");
    expect(root.querySelector("a.cite-link")?.getAttribute("href")).toMatch(/medicaid\.gov/);
  });

  it("explains the limited coverage in a non-expansion state", () => {
    const root = mount(mountMedicaid, new URLSearchParams({ st: "TX", hh: "1", inc: "10000" }));
    expect(rowValue(root, "Medicaid expansion")).toContain("has not expanded");
    expect(rowValue(root, "Likely eligible")).toContain("Limited");
  });
});

describe("ACA Premium Tax Credit", () => {
  it("credits the benchmark above the expected contribution at 200% FPL", () => {
    // Household of 1 at $30,120 = 200% FPL; applicable % = 2.0%; benchmark $600/mo.
    const root = mount(mountAcaPtc, new URLSearchParams({ hh: "1", inc: "30120", bm: "600" }));
    expect(rowValue(root, "Income vs poverty line")).toContain("200% FPL");
    expect(rowValue(root, "Expected contribution")).toContain("2.00%");
    expect(rowValue(root, "Estimated premium tax credit")).toContain("$549.80/mo");
    expect(root.querySelector("a.cite-link")).not.toBeNull();
  });

  it("prompts for the per-county benchmark premium before estimating", () => {
    const root = mount(mountAcaPtc, new URLSearchParams({ hh: "1", inc: "35000", bm: "0" }));
    expect(root.querySelector(".ph-empty")).not.toBeNull();
  });

  it("flags income below the Medicaid floor", () => {
    const root = mount(mountAcaPtc, new URLSearchParams({ hh: "1", inc: "10000", bm: "500" }));
    expect(rowValue(root, "Heads up")).toContain("Medicaid");
  });

  it("reads household size, region, and income from My Situation", () => {
    const profile = new SituationStore();
    profile.set("householdSize", 3);
    profile.set("stateCode", "hi");
    profile.set("annualIncome", 50000);
    const root = mount(mountAcaPtc, new URLSearchParams({ bm: "500" }), profile);
    expect(root.querySelector<HTMLInputElement>('input[name="hh"]')?.value).toBe("3");
    expect(root.querySelector<HTMLSelectElement>('select[name="region"]')?.value).toBe("hawaii");
    expect(root.querySelector<HTMLInputElement>('input[name="inc"]')?.value).toBe("50000");
  });
});

describe("FAFSA Student Aid Index tile", () => {
  it("estimates the SAI and the Pell it implies for a low-income family, cited", () => {
    const root = mount(
      mountFafsaSai,
      new URLSearchParams({
        pinc: "45000",
        ptax: "1500",
        size: "4",
        earn2: "18000",
        passet: "5000",
        sinc: "4000",
        stax: "0",
        sasset: "1000",
      }),
    );
    expect(rowValue(root, "Student Aid Index (SAI)")).toContain("-$293");
    expect(rowValue(root, "Estimated Pell Grant")).toContain("$7,395");
    expect(root.querySelector("a.cite-link")?.getAttribute("href")).toMatch(/studentaid\.gov/);
  });

  it("writes income and household size back to Your Situation", () => {
    const profile = new SituationStore();
    const root = mount(mountFafsaSai, new URLSearchParams(), profile);
    const pinc = root.querySelector<HTMLInputElement>('input[name="pinc"]')!;
    pinc.value = "60000";
    pinc.dispatchEvent(new Event("input"));
    const size = root.querySelector<HTMLInputElement>('input[name="size"]')!;
    size.value = "5";
    size.dispatchEvent(new Event("input"));
    expect(profile.get("annualIncome")).toBe(60000);
    expect(profile.get("householdSize")).toBe(5);
  });
});

describe("Pell Grant tile", () => {
  it("reduces the award as the SAI rises, cited", () => {
    const root = mount(mountPell, new URLSearchParams({ sai: "2000" }));
    expect(rowValue(root, "Estimated Pell Grant")).toContain("$5,395");
    expect(root.querySelector("a.cite-link")?.getAttribute("href")).toMatch(/studentaid\.gov/);
  });

  it("reports ineligibility once the SAI reaches the maximum Pell", () => {
    const root = mount(mountPell, new URLSearchParams({ sai: "8000" }));
    expect(rowValue(root, "Estimated Pell Grant")).toContain("Not Pell-eligible");
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
    {
      name: "savers-credit",
      mount: mountSaversCredit,
      params: new URLSearchParams({ fs: "single", agi: "21000", c: "2000" }),
    },
    { name: "snap", mount: mountSnap, params: new URLSearchParams({ hh: "3", inc: "2200" }) },
    {
      name: "medicaid",
      mount: mountMedicaid,
      params: new URLSearchParams({ st: "CA", hh: "1", inc: "18000" }),
    },
    {
      name: "aca-ptc",
      mount: mountAcaPtc,
      params: new URLSearchParams({ hh: "1", inc: "30120", bm: "600" }),
    },
    {
      name: "fafsa-sai",
      mount: mountFafsaSai,
      params: new URLSearchParams({ pinc: "45000", size: "4", earn2: "18000" }),
    },
    { name: "pell", mount: mountPell, params: new URLSearchParams({ sai: "2000" }) },
  ]) {
    it(`${tc.name} has no axe violations`, async () => {
      const root = mount(tc.mount, tc.params);
      document.body.append(root);
      const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
      expect(results.violations.map((v) => v.id).join(", ")).toBe("");
    }, 30000);
  }
});
