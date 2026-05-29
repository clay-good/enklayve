import { describe, it, expect, beforeAll, afterEach } from "vitest";
import axe from "axe-core";
import { renderReport } from "../../src/ui/reportView";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";

/**
 * The Readout Report view (BUILD-SPEC-2 §5): an in-app preview with a download
 * of a self-contained HTML file. Generated on the device from Your Situation.
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
  p.set("essentialMonthlyExpenses", 3200);
  p.set("liquidSavings", 12000);
  return p;
}

function mount(profile: SituationStore): { container: HTMLElement; dest: () => string | null } {
  const container = document.createElement("div");
  let dest: string | null = null;
  renderReport({ container, navigate: (id) => (dest = id), profile, data });
  document.body.append(container);
  return { container, dest: () => dest };
}

afterEach(() => document.body.replaceChildren());

describe("Readout Report view", () => {
  it("previews the report with its sections, download, and print", () => {
    const { container } = mount(fundedProfile());
    expect(container.querySelector(".tile-title")?.textContent).toBe("My Readout Report");
    const titles = Array.from(container.querySelectorAll(".report-section-title")).map(
      (n) => n.textContent ?? "",
    );
    expect(titles).toContain("Snapshot");
    expect(titles).toContain("Assumptions & sources");
    const buttons = Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).toContain("Download report (.html)");
    expect(buttons).toContain("Print");
  });

  it("shows cited sources the figures trace to", () => {
    const { container } = mount(fundedProfile());
    expect(container.querySelector(".report-appendix a.cite-link")?.getAttribute("href")).toMatch(
      /irs\.gov/,
    );
  });

  it("links onward to Your Plan", () => {
    const { container, dest } = mount(fundedProfile());
    Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent === "See My Plan →")!
      .click();
    expect(dest()).toBe("your-plan");
  });

  it("has no axe violations", async () => {
    const { container } = mount(fundedProfile());
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id).join(", ")).toBe("");
  }, 30000);
});
