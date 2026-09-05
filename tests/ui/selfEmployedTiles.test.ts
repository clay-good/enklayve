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
    const quarter = dollars(rowValue(root, "Q1 payment, due April 15"));
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

  it("halves the safe-harbor AGI threshold for a separate return", () => {
    // IRC §6654(d)(1)(C)(ii). $100,000 of prior-year AGI is under the general
    // $150,000 line and over the separate filer's $75,000 one, so these two
    // must disagree. Until 2026-09-05 they did not: the tile held a single
    // $150,000 literal, and the separate filer was told 100% of last year's tax
    // avoided the penalty when the statute wants 110% — an underpayment, on the
    // one line whose whole purpose is avoiding one.
    const base = { st: "", np: "90000", ly: "12000", lya: "100000" };
    const single = mount(mountQuarterlyTaxes, new URLSearchParams({ ...base, fs: "single" })).root;
    const separate = mount(
      mountQuarterlyTaxes,
      new URLSearchParams({ ...base, fs: "married_separately" }),
    ).root;
    expect(rowValue(single, "How the safe harbor was set")).toContain("100% of last year's tax");
    expect(rowValue(separate, "How the safe harbor was set")).toContain("110%");
    expect(rowValue(separate, "How the safe harbor was set")).toContain("$75,000");
  });

  it("measures the threshold on last year's AGI, and says when it had to guess", () => {
    // The statute reads "the adjusted gross income shown on the return of the
    // individual for the preceding taxable year". The tile tested *this* year's
    // computed AGI, which for a self-employed person is precisely the number
    // that moves: $200,000 of profit this year charged 110% off a prior year the
    // filer had not even reported.
    const thisYearHigh = new URLSearchParams({
      fs: "single",
      st: "",
      np: "200000",
      ly: "12000",
      lya: "80000",
    });
    expect(
      rowValue(mount(mountQuarterlyTaxes, thisYearHigh).root, "How the safe harbor was set"),
    ).toContain("100% of last year's tax");

    // Blank, and this year's AGI stands in — which is allowed, but it is said
    // out loud rather than presented as the statute's own answer.
    const blank = new URLSearchParams({ fs: "single", st: "", np: "200000", ly: "12000" });
    const proxied = rowValue(mount(mountQuarterlyTaxes, blank).root, "How the safe harbor was set");
    expect(proxied).toContain("110%");
    expect(proxied).toContain("We used this year's AGI because last year's is blank");
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

  it("never offers a ceiling above what the reader earned", () => {
    // §415(c)(1)(B): annual additions may not exceed 100% of compensation, and
    // §415(c)(3)(B) makes a self-employed person's compensation their earned
    // income. The tile applied only the dollar limb of §415(c)(1), adding a
    // deferral capped at net earnings to an employer share of 20% of the same
    // net earnings — so at $10,000 of profit it offered $11,152 against $9,294
    // of net earnings, 120% of what the person had. Over-contributing is a
    // correction, 10% under §4972 and 6% a year under §4973, and the tile's own
    // explainer recommends the solo 401(k) "especially at low-to-moderate
    // profit" — the exact range this was wrong in.
    for (const profit of ["4000", "10000", "30000"]) {
      const { root } = mount(
        mountSelfEmployedRetirement,
        new URLSearchParams({ fs: "single", np: profit, age: "45" }),
      );
      const net = dollars(rowValue(root, "Net self-employment earnings"));
      const solo = dollars(rowValue(root, "Solo 401(k) total"));
      const sep = dollars(rowValue(root, "SEP-IRA maximum"));
      expect(solo, `solo at $${profit} of profit`).toBeLessThanOrEqual(net);
      expect(sep, `sep at $${profit} of profit`).toBeLessThanOrEqual(net);
    }
  });

  it("says why the total is lower when compensation is the binding limit", () => {
    // A number that is smaller than the arithmetic a reader can do in their
    // head — 20% plus the full deferral — needs to say so, or it reads as a bug
    // in the page.
    const { root } = mount(
      mountSelfEmployedRetirement,
      new URLSearchParams({ fs: "single", np: "10000", age: "45" }),
    );
    expect(root.textContent).toContain("Why this is lower");
    expect(rowValue(root, "Why this is lower")).toContain("100% of your compensation");
    const high = mount(
      mountSelfEmployedRetirement,
      new URLSearchParams({ fs: "single", np: "90000", age: "45" }),
    ).root;
    expect(high.textContent).not.toContain("Why this is lower");
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
