import { describe, it, expect, beforeAll } from "vitest";
import { mountFederalIncomeTax } from "../../src/tiles/federalIncomeTax";
import { mountMarginalExplorer } from "../../src/tiles/marginalExplorer";
import { mountCompoundGrowth } from "../../src/tiles/compoundGrowth";
import { mountSelfEmploymentTax } from "../../src/tiles/selfEmploymentTax";
import { mountHourlySalary } from "../../src/tiles/hourlySalary";
import { mountLoanAmortization } from "../../src/tiles/loanAmortization";
import { mountRefinance } from "../../src/tiles/refinance";
import { mountAutoLoan } from "../../src/tiles/autoLoan";
import { mountRetirementOptimizer } from "../../src/tiles/retirementOptimizer";
import { mountCapitalGains } from "../../src/tiles/capitalGains";
import { mountInflation } from "../../src/tiles/inflation";
import { mountSavingsBond } from "../../src/tiles/savingsBond";
import { mountRmd } from "../../src/tiles/rmd";
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

describe("Refinance Break-Even tile", () => {
  it("shows a break-even when the new rate is lower, with no rule to cite", () => {
    const { root } = mount(
      mountRefinance,
      new URLSearchParams({ b: "300000", cr: "7", cy: "27", nr: "5.5", ny: "30", cc: "6000" }),
    );
    expect(root.querySelector(".result-label")?.textContent).toBe("Break-even point");
    expect(labels(root)).toContain("Monthly savings");
    expect(root.querySelector("a.cite-link")).toBeNull();
  });

  it("reports no break-even when the new rate isn't lower", () => {
    const { root } = mount(
      mountRefinance,
      new URLSearchParams({ b: "300000", cr: "5", cy: "27", nr: "6.5", ny: "30", cc: "6000" }),
    );
    expect(root.querySelector(".result-label")?.textContent).toBe("No break-even at this rate");
    expect(labels(root)).toContain("Monthly change");
  });
});

describe("Auto Loan tile", () => {
  it("amortizes the financed amount and shows the true cost of credit", () => {
    const { root } = mount(
      mountAutoLoan,
      new URLSearchParams({ a: "32000", apr: "7.5", y: "6", f: "1500" }),
    );
    expect(root.querySelector(".result-label")?.textContent).toBe("Monthly payment");
    const ls = labels(root);
    expect(ls).toContain("True cost of credit (interest)");
    expect(ls).toContain("Effective annual rate");
    // Financed amount includes the rolled-in fees: 32,000 + 1,500.
    const financed = Array.from(root.querySelectorAll(".bd-row"))
      .find((r) => r.querySelector(".bd-label")?.textContent === "Amount financed")
      ?.querySelector(".bd-value")?.textContent;
    expect(financed).toContain("33,500");
    expect(root.querySelector("a.cite-link")).toBeNull();
  });
});

describe("Retirement Contribution Optimizer tile", () => {
  it("applies catch-up at 50+ and cites the IRS limits", () => {
    const { root } = mount(
      mountRetirementOptimizer,
      new URLSearchParams({ age: "52", k: "12000", ira: "3000", hsa: "family", h: "4000" }),
    );
    expect(root.querySelector(".result-label")?.textContent).toBe(
      "Tax-advantaged room left this year",
    );
    const ls = labels(root);
    // 50+ → catch-up annotation on the 401(k) and IRA limits.
    expect(ls.some((l) => l.startsWith("401(k) limit (with catch-up)"))).toBe(true);
    expect(ls).toContain("401(k) room remaining");
    // HSA section shows because coverage is selected.
    expect(ls.some((l) => l.startsWith("HSA limit"))).toBe(true);
    // Every limit cites the IRS notice.
    expect(root.querySelectorAll("a.cite-link").length).toBeGreaterThanOrEqual(3);
  });

  it("reads the 401(k) from the profile and writes edits back", () => {
    const profile = new SituationStore();
    profile.set("retirementContributionsAnnual", 8000);
    const { root } = mount(mountRetirementOptimizer, new URLSearchParams({ age: "40" }), profile);
    expect(root.querySelector<HTMLInputElement>('input[name="k"]')?.value).toBe("8000");
    const k = root.querySelector<HTMLInputElement>('input[name="k"]')!;
    k.value = "15000";
    k.dispatchEvent(new Event("input"));
    expect(profile.get("retirementContributionsAnnual")).toBe(15000);
    // Under 50 → no catch-up annotation.
    expect(labels(root).some((l) => l.includes("catch-up"))).toBe(false);
  });
});

describe("Capital Gains tile", () => {
  it("splits long-term gains into bands and cites each layer", () => {
    const { root } = mount(
      mountCapitalGains,
      new URLSearchParams({ fs: "single", ord: "90000", st: "5000", lt: "20000" }),
    );
    expect(root.querySelector(".result-label")?.textContent).toBe("Tax on your capital gains");
    const ls = labels(root);
    expect(ls).toContain("Short-term gain (taxed as ordinary income)");
    expect(ls.some((l) => l.startsWith("Long-term gain at 15%"))).toBe(true);
    expect(ls).toContain("Total tax on gains");
    expect(ls).toContain("Effective rate on gains");
    // Short-term cites the federal brackets; long-term cites the capital-gains data.
    expect(root.querySelectorAll("a.cite-link").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the NIIT line when modified AGI is high enough", () => {
    const { root } = mount(
      mountCapitalGains,
      new URLSearchParams({ fs: "single", ord: "190000", lt: "50000", magi: "240000" }),
    );
    expect(labels(root).some((l) => l.startsWith("Net Investment Income Tax"))).toBe(true);
  });

  it("prefills the worked example and writes filing status to the profile", () => {
    const profile = new SituationStore();
    const { root } = mount(mountCapitalGains, new URLSearchParams(), profile);
    clickExample(root);
    expect(root.querySelector<HTMLInputElement>('input[name="lt"]')?.value).toBe("20000");
    expect(profile.get("filingStatus")).toBe("single");
  });
});

describe("CPI Inflation Adjuster tile", () => {
  it("adjusts an amount across years, cited to BLS", () => {
    const { root } = mount(
      mountInflation,
      new URLSearchParams({ amt: "100", from: "2000", to: "2024" }),
    );
    expect(root.querySelector(".result-card")).not.toBeNull();
    expect(labels(root)).toContain("Equivalent in 2024 dollars");
    expect(root.querySelector("a.cite-link")?.getAttribute("href")).toMatch(/bls\.gov/);
  });

  it("only offers years present in the dataset", () => {
    const { root } = mount(mountInflation, new URLSearchParams());
    const fromOpts = Array.from(
      root.querySelectorAll<HTMLSelectElement>('select[name="from"] option'),
    ).map((o) => o.value);
    expect(fromOpts).toContain("2024");
    expect(fromOpts).not.toContain("1800");
  });
});

describe("Treasury I Bond tile", () => {
  it("values a bond from the bundled TreasuryDirect rates, cited to Treasury", () => {
    const { root } = mount(
      mountSavingsBond,
      new URLSearchParams({ amt: "10000", period: "2022-05" }),
    );
    expect(root.querySelector(".result-card")).not.toBeNull();
    expect(labels(root)).toContain("Value now");
    expect(labels(root)).toContain("Fixed rate (locked at purchase)");
    expect(root.querySelector("a.cite-link")?.getAttribute("href")).toMatch(/treasurydirect\.gov/);
  });

  it("only offers purchase periods present in the dataset", () => {
    const { root } = mount(mountSavingsBond, new URLSearchParams());
    const opts = Array.from(
      root.querySelectorAll<HTMLSelectElement>('select[name="period"] option'),
    ).map((o) => o.value);
    expect(opts).toContain("2024-05");
    expect(opts).not.toContain("1999-05");
  });

  it("prefills a worked example", () => {
    const { root, lastParams } = mount(mountSavingsBond, new URLSearchParams());
    clickExample(root);
    expect(lastParams()?.get("amt")).toBe("10000");
    expect(root.querySelector(".result-card")).not.toBeNull();
  });
});

describe("Required Minimum Distribution tile", () => {
  it("computes the RMD from the Uniform Lifetime Table, cited to the IRS", () => {
    const { root } = mount(mountRmd, new URLSearchParams({ age: "75", bal: "500000" }));
    expect(root.querySelector(".result-label")?.textContent).toBe(
      "Your required minimum distribution this year",
    );
    expect(labels(root)).toContain("Required minimum distribution");
    expect(root.querySelector("a.cite-link")?.getAttribute("href")).toMatch(/irs\.gov/);
  });

  it("says no RMD is due below the begin age, with no number invented", () => {
    const { root } = mount(mountRmd, new URLSearchParams({ age: "68", bal: "500000" }));
    expect(root.querySelector(".result-card")).toBeNull();
    expect(root.textContent).toContain("No RMD is required yet");
  });
});
