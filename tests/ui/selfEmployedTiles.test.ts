import { describe, it, expect, beforeAll, afterEach } from "vitest";
import axe from "axe-core";
import { mountQuarterlyTaxes } from "../../src/tiles/quarterlyTaxes";
import { mountFreelanceRate } from "../../src/tiles/freelanceRate";
import { mountSelfEmployedRetirement } from "../../src/tiles/selfEmployedRetirement";
import { mountContractVsSalary } from "../../src/tiles/contractVsSalary";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

/**
 * Self-employed / 1099 toolkit (BUILD-SPEC-2 §6.4): quarterly tax set-aside, the
 * "what should I charge" rate calculator, SEP-vs-Solo-401(k) retirement, and the
 * 1099-vs-W-2 translator. All reuse the existing tax engine + bundled limits;
 * deterministic, deep-linkable, axe-clean.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(
  mountFn: (ctx: TileContext) => void,
  params: URLSearchParams,
  profile = new SituationStore(),
): { root: HTMLElement; lastParams: () => URLSearchParams | null } {
  const root = document.createElement("div");
  let captured: URLSearchParams | null = null;
  mountFn({
    root,
    params,
    setParams: (p) => {
      captured = p;
    },
    permalink: (p) => `https://enklayve.com/#/x?${(p ?? params).toString()}`,
    navigate: () => {},
    locale: "en-US",
    data,
    profile,
  });
  return { root, lastParams: () => captured };
}

function rowValue(root: HTMLElement, labelStarts: string): string | undefined {
  const rows = Array.from(root.querySelectorAll(".bd-row"));
  const row = rows.find((r) =>
    (r.querySelector(".bd-label")?.textContent ?? "").startsWith(labelStarts),
  );
  return row?.querySelector(".bd-value")?.textContent ?? undefined;
}
function dollars(text: string | undefined): number {
  return Number((text ?? "").replace(/[^0-9.-]/g, ""));
}

afterEach(() => document.body.replaceChildren());

describe("Quarterly Taxes & Set-Aside", () => {
  it("sums SE tax + income tax, splits into four quarters, and shows a set-aside %", () => {
    const { root } = mount(
      mountQuarterlyTaxes,
      new URLSearchParams({ fs: "single", st: "", np: "90000" }),
    );
    const total = dollars(rowValue(root, "Total estimated tax"));
    const quarter = dollars(rowValue(root, "Quarterly payment, Apr 15"));
    expect(total).toBeGreaterThan(0);
    expect(quarter).toBeCloseTo(total / 4, 0);
    // Both taxes a 1099 worker owes are itemized, each with a source.
    expect(rowValue(root, "Self-employment tax")).toBeDefined();
    expect(rowValue(root, "Federal income tax")).toBeDefined();
    expect(root.querySelector("a.cite-link")).not.toBeNull();
    // The set-aside share and the donut both render.
    expect(root.textContent).toContain("Set aside this share");
    expect(root.querySelector(".chart--donut")).not.toBeNull();
  });

  it("shows the safe-harbor minimum when last year's tax is given", () => {
    const { root } = mount(
      mountQuarterlyTaxes,
      new URLSearchParams({ fs: "single", st: "", np: "90000", ly: "12000" }),
    );
    expect(root.textContent).toContain("Safe-harbor minimum");
  });
});

describe("What Should I Charge?", () => {
  it("works backward from take-home to an hourly rate", () => {
    const { root } = mount(
      mountFreelanceRate,
      new URLSearchParams({ th: "60000", bh: "25", wk: "48", ex: "6000", tx: "28" }),
    );
    // profit 60000/0.72 = 83,333; +6,000 expenses = 89,333; /1,200 billable hrs ≈ 74.44
    const rate = dollars(rowValue(root, "Rate to bill per hour"));
    expect(rate).toBeGreaterThan(74);
    expect(rate).toBeLessThan(75);
    // It's a guideline, not a cited rule.
    expect(root.querySelector("a.cite-link")).toBeNull();
  });

  it("shows an empty-state instead of a bare $0 when there are no billable hours", () => {
    const { root } = mount(
      mountFreelanceRate,
      new URLSearchParams({ th: "60000", bh: "0", wk: "0", ex: "0", tx: "28" }),
    );
    expect(rowValue(root, "Rate to bill per hour")).toContain("enter billable hours");
    expect(rowValue(root, "Day rate (8 hours)")).toContain("enter billable hours");
  });
});

describe("Self-Employed Retirement", () => {
  it("lets the Solo 401(k) beat the SEP-IRA at a moderate income, both under the cap", () => {
    const { root } = mount(
      mountSelfEmployedRetirement,
      new URLSearchParams({ fs: "single", np: "90000", age: "45" }),
    );
    const sep = dollars(rowValue(root, "SEP-IRA maximum"));
    const solo = dollars(rowValue(root, "Solo 401(k) total"));
    expect(solo).toBeGreaterThan(sep);
    expect(sep).toBeLessThanOrEqual(69000);
    expect(solo).toBeLessThanOrEqual(69000);
  });
});

describe("1099 Contract vs W-2 Salary", () => {
  it("subtracts employer-side FICA and benefits to reach an equivalent salary", () => {
    const { root } = mount(
      mountContractVsSalary,
      new URLSearchParams({ fs: "single", r: "75", h: "2000", b: "12000" }),
    );
    // gross 150,000; employer FICA ≈ 0.0765 × 150,000 = 11,475; − 12,000 benefits.
    const fica = dollars(rowValue(root, "Employer-side FICA"));
    const equiv = dollars(rowValue(root, "Roughly equal to a W-2 salary of"));
    expect(fica).toBeCloseTo(11475, 0);
    expect(equiv).toBeCloseTo(150000 - 11475 - 12000, 0);
  });
});

describe("self-employed tiles accessibility", () => {
  for (const tc of [
    {
      name: "quarterly-taxes",
      mount: mountQuarterlyTaxes,
      params: new URLSearchParams({ fs: "single", st: "ca", np: "90000", ly: "12000" }),
    },
    {
      name: "freelance-rate",
      mount: mountFreelanceRate,
      params: new URLSearchParams({ th: "60000", bh: "25", wk: "48", ex: "6000" }),
    },
    {
      name: "se-retirement",
      mount: mountSelfEmployedRetirement,
      params: new URLSearchParams({ fs: "single", np: "90000", age: "52" }),
    },
    {
      name: "contract-vs-salary",
      mount: mountContractVsSalary,
      params: new URLSearchParams({ fs: "single", r: "75", h: "2000", b: "12000" }),
    },
  ]) {
    it(`${tc.name} has no axe violations`, async () => {
      const { root } = mount(tc.mount, tc.params);
      document.body.append(root);
      const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
      expect(results.violations.map((v) => v.id).join(", ")).toBe("");
    }, 30000);
  }
});
