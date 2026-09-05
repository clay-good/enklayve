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
/** The value cell beside the first breakdown label starting with `label`. */
function rowValue(root: HTMLElement, label: string): string {
  for (const row of root.querySelectorAll(".bd-row")) {
    if ((row.querySelector(".bd-label")?.textContent ?? "").startsWith(label)) {
      return row.querySelector(".bd-value")?.textContent ?? "";
    }
  }
  return "";
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

  it("names Ohio's $26,050 step when the next dollars cross it", () => {
    // Ohio Rev. Code §5747.02(A)(3)(c) owes nothing at or below $26,050 of
    // taxable income and "$332.00 plus 2.75% of the amount in excess" above it,
    // and the bands below are 0%, so the $332 is not accumulated tax being
    // restated. It arrives whole on the first dollar over. Reporting only a
    // "combined marginal rate" for a step that crosses it is a true number and
    // a misleading answer: the reader would read a rate off it and apply it to
    // the next dollar, which costs 2.75%.
    const { root } = mount(
      mountMarginalExplorer,
      new URLSearchParams({ fs: "single", st: "oh", inc: "26000", step: "1000" }),
    );
    const ls = labels(root);
    expect(ls.some((l) => l.includes("$26,050 step"))).toBe(true);
    const note = root.querySelector(".statute-step")?.textContent ?? "";
    expect(note).toContain("$332.00");
    expect(note).toContain("step, not a rate");
    // And it is cited to the state's own schedule, like every other line here.
    expect(root.querySelectorAll("a.cite-link").length).toBeGreaterThanOrEqual(3);
  });

  it("says nothing about a step the next dollars do not reach", () => {
    // An Ohio filer well past the line is not crossing anything, and one well
    // below it is not either. A note that fires on the state rather than on the
    // crossing would be furniture within a week.
    for (const inc of ["10000", "80000"]) {
      const { root } = mount(
        mountMarginalExplorer,
        new URLSearchParams({ fs: "single", st: "oh", inc, step: "1000" }),
      );
      expect(root.querySelector(".statute-step"), `income ${inc}`).toBeNull();
    }
  });

  it("says nothing in a state whose schedule has no such step", () => {
    const { root } = mount(
      mountMarginalExplorer,
      new URLSearchParams({ fs: "single", st: "ca", inc: "26000", step: "1000" }),
    );
    expect(root.querySelector(".statute-step")).toBeNull();
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

  it("signposts an extreme return assumption without clamping it (SPEC-3 §2.4)", () => {
    // A defensible rate carries no hint, and the math still runs.
    const calm = mount(mountCompoundGrowth, new URLSearchParams({ p: "10000", r: "6", y: "30" }));
    expect(calm.root.querySelector(".assumption-hint")).toBeNull();
    // An 80% return is far outside any defensible band: a calm hint appears, the
    // input is unchanged, and the projection is still computed.
    const wild = mount(mountCompoundGrowth, new URLSearchParams({ p: "10000", r: "80", y: "30" }));
    const hint = wild.root.querySelector(".assumption-hint");
    expect(hint?.textContent).toContain("unusually high");
    expect(wild.root.querySelector<HTMLInputElement>('input[name="r"]')?.value).toBe("80");
    expect(wild.root.querySelector(".result-card")).not.toBeNull();
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

  it("asks for the employer match, and answers My Plan's question with it", () => {
    // The tile's own header comment has said since it was written that it
    // "writes back to My Situation so it feeds My Plan's capture-the-match
    // step". It wrote the 401(k) contribution and nothing else: the two match
    // fields existed in the profile and in the step that spends them, and no
    // surface on the site set either. So every reader's plan compared 0 against
    // 0, called the step satisfied, and stepped over the one move that pays a
    // guaranteed return without saying it had.
    const profile = new SituationStore();
    const { root, lastParams } = mount(mountRetirementOptimizer, new URLSearchParams(), profile);
    const match = root.querySelector<HTMLInputElement>('input[name="m"]')!;
    const captured = root.querySelector<HTMLInputElement>('input[name="mc"]')!;
    match.value = "6000";
    match.dispatchEvent(new Event("input"));
    captured.value = "2000";
    captured.dispatchEvent(new Event("input"));
    expect(profile.get("employerMatchAnnual")).toBe(6000);
    expect(profile.get("employerMatchCaptured")).toBe(2000);

    // And the link carries both, including a zero — which is a real answer
    // ("my employer offers none") that the plan reads differently from silence,
    // so a link dropping it would reopen on a different plan than the sender
    // saw.
    match.value = "0";
    match.dispatchEvent(new Event("input"));
    expect(lastParams()?.get("m")).toBe("0");
    expect(lastParams()?.get("mc")).toBe("2000");
    expect(profile.get("employerMatchAnnual")).toBe(0);
  });

  it("gives a 61-year-old the 60–63 catch-up, and a 64-year-old the ordinary one", () => {
    // The shard has carried `catch_up_401k_60to63` since the 2026 limits landed
    // and this tile read `catch_up_401k_50plus` for every age over 50, so a
    // 61-year-old was told $32,500 where §414(v)(2)(E)(i) says $35,750. The
    // 64-year-old is the other half of the same rule: the window closes.
    const at61 = mount(mountRetirementOptimizer, new URLSearchParams({ age: "61", k: "0" }));
    const l61 = labels(at61.root);
    expect(l61.some((l) => l.startsWith("401(k) limit (with the 60–63 catch-up)"))).toBe(true);
    expect(rowValue(at61.root, "401(k) limit")).toContain("$35,750");

    const at64 = mount(mountRetirementOptimizer, new URLSearchParams({ age: "64", k: "0" }));
    const l64 = labels(at64.root);
    expect(l64.some((l) => l.startsWith("401(k) limit (with catch-up)"))).toBe(true);
    expect(rowValue(at64.root, "401(k) limit")).toContain("$32,500");
  });

  it("tells a high earner their catch-up has to be Roth, and stays quiet otherwise", () => {
    // The tile's whole claim is "tax-advantaged room left this year", and for
    // the group most likely to use a catch-up, part of that room is after-tax
    // from 2026: §414(v)(7) lets a participant whose prior-year wages from that
    // employer exceeded $150,000 make the catch-up only as Roth.
    const { root: high } = mount(
      mountRetirementOptimizer,
      new URLSearchParams({ age: "55", k: "0", pw: "180000" }),
    );
    expect(rowValue(high, "Your catch-up has to be Roth")).toContain("after-tax");
    // The amount is unchanged — the rule moves the tax treatment, not the room.
    expect(rowValue(high, "401(k) limit")).toContain("$32,500");

    const { root: under } = mount(
      mountRetirementOptimizer,
      new URLSearchParams({ age: "55", k: "0", pw: "120000" }),
    );
    expect(rowValue(under, "Your catch-up has to be Roth")).toBe("");

    // And nothing for someone with no catch-up to make in the first place.
    const { root: young } = mount(
      mountRetirementOptimizer,
      new URLSearchParams({ age: "40", k: "0", pw: "180000" }),
    );
    expect(rowValue(young, "Your catch-up has to be Roth")).toBe("");
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
  it("says so when a shared link's loss was read as zero", () => {
    // `parseNonNegative` clamps a negative gain to zero, which is correct —
    // this tool models gains, and §1211(b)'s $3,000 limit lives in Tax-Loss
    // Harvesting — but the clamp was silent. A link carrying `lt=-5000` then
    // produced a confident figure computed from a number nobody supplied, and
    // the disclosure seam SPEC-3 §2.3 exists for is used by three other tiles.
    const { root } = mount(
      mountCapitalGains,
      new URLSearchParams({ fs: "single", ord: "80000", lt: "-5000" }),
    );
    const note = root.querySelector(".clamp-note")?.textContent ?? "";
    expect(note).toContain("the long-term loss was read as zero");
    expect(note).toContain("Tax-Loss Harvesting");
  });

  it("stays quiet when nothing was clamped", () => {
    const { root } = mount(
      mountCapitalGains,
      new URLSearchParams({ fs: "single", ord: "80000", lt: "5000" }),
    );
    expect(root.querySelector(".clamp-note")).toBeNull();
  });

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
