import { describe, it, expect, beforeAll } from "vitest";
import { mountFederalIncomeTax } from "../../src/tiles/federalIncomeTax";
import { mountMarginalExplorer } from "../../src/tiles/marginalExplorer";
import { mountCompoundGrowth } from "../../src/tiles/compoundGrowth";
import { mountSelfEmploymentTax } from "../../src/tiles/selfEmploymentTax";
import { mountHourlySalary } from "../../src/tiles/hourlySalary";
import { mountLoanAmortization } from "../../src/tiles/loanAmortization";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

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

function labels(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll(".bd-label")).map((n) => n.textContent ?? "");
}
function clickExample(root: HTMLElement): void {
  Array.from(root.querySelectorAll("button"))
    .find((b) => b.textContent === "Try an example")!
    .click();
}

describe("Federal Income Tax tile", () => {
  it("picks itemized when the big four exceed the standard deduction", () => {
    const { root } = mount(
      mountFederalIncomeTax,
      new URLSearchParams({
        fs: "single",
        inc: "95000",
        dm: "auto",
        salt: "9000",
        mort: "8000",
        char: "3000",
      }),
    );
    expect(root.querySelector(".result-label")?.textContent).toBe("Federal income tax");
    expect(labels(root)).toContain("Itemized deduction");
    // Federal line carries the IRS citation.
    expect(root.querySelector("a.cite-link")?.getAttribute("href")).toMatch(/irs\.gov/);
  });

  it("restores inputs from a deep link and writes edits back", () => {
    const { root, lastParams } = mount(
      mountFederalIncomeTax,
      new URLSearchParams({ fs: "married_jointly", inc: "150000" }),
    );
    expect(root.querySelector<HTMLInputElement>('input[name="inc"]')?.value).toBe("150000");
    expect(root.querySelector<HTMLSelectElement>('select[name="fs"]')?.value).toBe(
      "married_jointly",
    );
    const inc = root.querySelector<HTMLInputElement>('input[name="inc"]')!;
    inc.value = "200000";
    inc.dispatchEvent(new Event("input"));
    expect(lastParams()?.get("inc")).toBe("200000");
  });

  it("prefills a worked example", () => {
    const { root } = mount(mountFederalIncomeTax, new URLSearchParams());
    clickExample(root);
    expect(root.querySelector<HTMLInputElement>('input[name="inc"]')?.value).toBe("95000");
    expect(root.querySelector(".result-card")).not.toBeNull();
  });
});

describe("Marginal Rate Explorer tile", () => {
  it("attributes the cost of the next dollars to each layer, cited", () => {
    const { root } = mount(
      mountMarginalExplorer,
      new URLSearchParams({ fs: "single", st: "ca", inc: "120000", step: "1000" }),
    );
    const ls = labels(root);
    expect(ls).toContain("Federal income tax");
    expect(ls).toContain("FICA");
    expect(ls.some((l) => l.includes("California"))).toBe(true);
    expect(ls).toContain("Combined marginal rate");
    // Every cited layer links a source.
    expect(root.querySelectorAll("a.cite-link").length).toBeGreaterThanOrEqual(3);
  });

  it("the cost of the next $1,000 is between $0 and $1,000", () => {
    const { root } = mount(
      mountMarginalExplorer,
      new URLSearchParams({ fs: "single", st: "ca", inc: "120000", step: "1000" }),
    );
    const rows = Array.from(root.querySelectorAll(".bd-row"));
    const total = rows
      .find((r) => r.querySelector(".bd-label")?.textContent === "Total cost of the next dollars")
      ?.querySelector(".bd-value")?.textContent;
    const cost = Number(total?.replace(/[^0-9.-]/g, ""));
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(1000);
  });
});

describe("Compound Growth tile", () => {
  it("projects a balance above contributions and labels the assumption", () => {
    const { root } = mount(
      mountCompoundGrowth,
      new URLSearchParams({ p: "10000", c: "500", r: "6", y: "30", freq: "monthly" }),
    );
    expect(root.querySelector(".result-card")).not.toBeNull();
    const ls = labels(root);
    expect(ls).toContain("Future value");
    expect(ls).toContain("Growth");
    // The rate is shown as the user's assumption, not a cited rule.
    const assumption = Array.from(root.querySelectorAll(".bd-value")).some((n) =>
      n.textContent?.includes("your assumption"),
    );
    expect(assumption).toBe(true);
    expect(root.querySelector("a.cite-link")).toBeNull();
  });

  it("writes its state to the URL for deep linking", () => {
    const { root, lastParams } = mount(mountCompoundGrowth, new URLSearchParams());
    clickExample(root);
    expect(lastParams()?.get("p")).toBe("10000");
    expect(lastParams()?.get("y")).toBe("30");
  });
});

describe("Self-Employment Tax tile", () => {
  it("breaks out SE tax with the quarterly schedule, every line cited", () => {
    const { root } = mount(
      mountSelfEmploymentTax,
      new URLSearchParams({ fs: "single", np: "80000" }),
    );
    expect(root.querySelector(".result-label")?.textContent).toBe("Self-employment tax");
    const ls = labels(root);
    expect(ls).toContain("Total self-employment tax");
    expect(ls).toContain("Deductible half (adjustment to income)");
    // Four quarterly installments, each cited to Form 1040-ES.
    expect(ls.filter((l) => l.startsWith("Quarterly estimate")).length).toBe(4);
    expect(root.querySelectorAll("a.cite-link").length).toBeGreaterThanOrEqual(4);
  });

  it("prefills the worked example and writes filing status to the profile", () => {
    const profile = new SituationStore();
    const { root } = mount(mountSelfEmploymentTax, new URLSearchParams(), profile);
    clickExample(root);
    expect(root.querySelector<HTMLInputElement>('input[name="np"]')?.value).toBe("80000");
    expect(profile.get("filingStatus")).toBe("single");
  });
});

describe("Hourly ↔ Salary tile", () => {
  it("annualizes an hourly rate with overtime, with no rule to cite", () => {
    const { root } = mount(
      mountHourlySalary,
      new URLSearchParams({ m: "hourly", hr: "28", h: "40", ot: "5" }),
    );
    expect(root.querySelector(".result-label")?.textContent).toBe("Annual income");
    expect(labels(root)).toContain("Combined annual");
    // Pure arithmetic on the user's pay — no citation.
    expect(root.querySelector("a.cite-link")).toBeNull();
  });

  it("stacks a second job and writes combined income to the profile", () => {
    const profile = new SituationStore();
    const { root } = mount(
      mountHourlySalary,
      new URLSearchParams({ m: "hourly", hr: "28", h: "40", wk: "52", j2: "12000" }),
      profile,
    );
    expect(labels(root)).toContain("Second job, annual");
    // An edit recomputes and writes back: 28×40×52 = 58,240 + 12,000 = 70,240.
    const hr = root.querySelector<HTMLInputElement>('input[name="hr"]')!;
    hr.dispatchEvent(new Event("input"));
    expect(profile.get("annualIncome")).toBe(70240);
  });
});

describe("Loan & Mortgage Amortization tile", () => {
  it("shows the extra-payment what-if and cites no external rule", () => {
    const { root } = mount(
      mountLoanAmortization,
      new URLSearchParams({ p: "320000", r: "6.5", y: "30", x: "200" }),
    );
    expect(root.querySelector(".result-label")?.textContent).toBe("Monthly payment");
    const ls = labels(root);
    expect(ls).toContain("Scheduled monthly payment");
    expect(ls).toContain("Interest saved by the extra payment");
    expect(ls).toContain("Time saved");
    expect(root.querySelector("a.cite-link")).toBeNull();
  });

  it("hides the what-if lines with no extra payment", () => {
    const { root } = mount(
      mountLoanAmortization,
      new URLSearchParams({ p: "320000", r: "6.5", y: "30" }),
    );
    expect(labels(root)).not.toContain("Interest saved by the extra payment");
  });
});
