import { describe, it, expect, beforeAll } from "vitest";
import { buildReport, renderReportHtml } from "../../src/readout/report";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";

/**
 * The Readout Report (BUILD-SPEC-2 §5): generated on the device, every figure
 * traceable to a citation in the appendix, and reproducible — the same profile
 * and dataset versions produce an identical document.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function fundedProfile(): SituationStore {
  const p = new SituationStore();
  p.set("annualIncome", 95000);
  p.set("filingStatus", "single");
  p.set("stateCode", "ca");
  p.set("householdSize", 4);
  p.set("essentialMonthlyExpenses", 3200);
  p.set("liquidSavings", 12000);
  p.set("debts", [{ name: "Card", balance: 6000, ratePct: 23 }]);
  return p;
}

describe("the Report asks the engine, not a number it remembers", () => {
  /** A household under DC's expansion threshold and over the federal one. */
  function inDc(income: number): SituationStore {
    const p = new SituationStore();
    p.set("annualIncome", income);
    p.set("filingStatus", "single");
    p.set("stateCode", "dc");
    p.set("householdSize", 1);
    return p;
  }

  it("uses DC's 215% threshold, which the hardcoded 138 could not see", () => {
    // The Report tested `p <= 138` against a literal it held itself, and the
    // Medicaid shard carries a per-state override the literal ignored: DC
    // expands to 215% of the poverty line. A single DC resident earning
    // $28,000 is around 170% of it — eligible in DC, and told otherwise by a
    // document generated beside a Medicaid tile that says the opposite.
    const owed = buildReport(inDc(28_000), data).sections.find(
      (s) => s.title === "What you may be owed",
    );
    const medicaid = owed?.lines.find((l) => l.label === "Medicaid");
    expect(medicaid, "a DC resident at ~170% FPL should be flagged eligible").toBeDefined();
    expect(medicaid?.value).toContain("215%");
  });

  it("still points a household above the threshold at the premium tax credit", () => {
    // ~320% of the poverty line for one person: over DC's 215% and under the
    // 400% ceiling that came back for 2026.
    const owed = buildReport(inDc(50_000), data).sections.find(
      (s) => s.title === "What you may be owed",
    );
    expect(owed?.lines.find((l) => l.label === "Medicaid")).toBeUndefined();
    expect(owed?.lines.find((l) => l.label === "ACA premium tax credit")).toBeDefined();
  });

  it("says nothing about either above the restored 400% cliff", () => {
    // §36B(c)(1)(B)'s suspension was repealed by Pub. L. 119-21 §71302(a), so
    // there is no credit above 400% of the poverty line for 2026. The Report's
    // old `p >= 100` had no upper bound at all and would have offered one.
    const owed = buildReport(inDc(300_000), data).sections.find(
      (s) => s.title === "What you may be owed",
    );
    expect(owed?.lines.find((l) => l.label === "ACA premium tax credit")).toBeUndefined();
  });
});

describe("Readout Report, model", () => {
  it("composes a snapshot, tax picture, plan, and appendix from Your Situation", () => {
    const model = buildReport(fundedProfile(), data);
    expect(model.hasIncomeData).toBe(true);
    const titles = model.sections.map((s) => s.title);
    expect(titles).toContain("Snapshot");
    expect(titles).toContain("My tax picture");
    expect(titles).toContain("What you may be owed");
    expect(titles.some((t) => t.startsWith("My Plan"))).toBe(true);

    const snapshot = model.sections.find((s) => s.title === "Snapshot")!;
    expect(snapshot.lines.find((l) => l.label === "Annual income")?.value).toContain("$95,000");
    expect(snapshot.lines.some((l) => l.label === "Effective tax rate")).toBe(true);
  });

  it("traces every tax figure to a citation in the appendix", () => {
    const model = buildReport(fundedProfile(), data);
    // Federal + FICA + state (CA) citations all present.
    expect(model.appendix.citations.length).toBeGreaterThanOrEqual(3);
    expect(model.appendix.citations.some((c) => /irs\.gov/.test(c.sourceUrl))).toBe(true);
    expect(model.appendix.datasets.some((d) => d.id === "federal-income-tax-2024")).toBe(true);
  });

  it("summarizes FPL position and points to the screener for credit estimates", () => {
    const owed = buildReport(fundedProfile(), data).sections.find(
      (s) => s.title === "What you may be owed",
    )!;
    // $95,000 for a household of 4 ≈ 304% of the 2024 contiguous poverty line.
    expect(owed.lines.find((l) => l.label.includes("poverty line"))?.value).toMatch(/% of FPL/);
    expect(owed.note).toMatch(/What Am I Owed screener/);
  });

  it("estimates EITC/CTC and flags Medicaid for a lower-income household with children", () => {
    const p = new SituationStore();
    p.set("annualIncome", 38000);
    p.set("filingStatus", "married_jointly");
    p.set("stateCode", "ca");
    p.set("householdSize", 4);
    p.set("ages", [40, 38, 10, 8]); // two qualifying children (under 17)
    const owed = buildReport(p, data).sections.find((s) => s.title === "What you may be owed")!;
    const labels = owed.lines.map((l) => l.label);
    // ~122% of the 2024 contiguous poverty line for a family of four → Medicaid-likely.
    expect(labels).toContain("Medicaid");
    const eitc = owed.lines.find((l) => l.label.startsWith("Earned Income Tax Credit"));
    const ctc = owed.lines.find((l) => l.label.startsWith("Child Tax Credit"));
    expect(eitc?.value).toMatch(/\$/);
    expect(ctc?.value).toMatch(/\$/);
  });

  it("degrades gracefully when no income is entered", () => {
    const model = buildReport(new SituationStore(), data);
    expect(model.hasIncomeData).toBe(false);
    const snapshot = model.sections.find((s) => s.title === "Snapshot")!;
    expect(snapshot.lines[0]?.value).toMatch(/Add your income/);
  });

  it("is reproducible: same profile + datasets → identical model and HTML", () => {
    const a = buildReport(fundedProfile(), data);
    const b = buildReport(fundedProfile(), data);
    expect(a).toEqual(b);
    expect(renderReportHtml(a)).toBe(renderReportHtml(b));
  });
});

describe("Readout Report, HTML", () => {
  it("is a complete, self-contained, script-free document", () => {
    const html = renderReportHtml(buildReport(fundedProfile(), data));
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>My Readout Report · enklayve</title>");
    expect(html).toContain("Assumptions &amp; sources");
    // Self-contained and safe: no scripts, no external resource loads.
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/src=/);
  });

  it("escapes interpolated values", () => {
    const p = fundedProfile();
    // A debt name with HTML must not break out into markup.
    p.set("debts", [{ name: "<b>x</b>", balance: 6000, ratePct: 23 }]);
    const html = renderReportHtml(buildReport(p, data));
    expect(html).not.toContain("<b>x</b>");
  });
});
