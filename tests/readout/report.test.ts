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
