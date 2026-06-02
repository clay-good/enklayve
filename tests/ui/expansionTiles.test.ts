import { describe, it, expect, afterEach } from "vitest";
import axe from "axe-core";
import { mountSpendingPlan } from "../../src/tiles/spendingPlan";
import { mountHomeAffordability } from "../../src/tiles/homeAffordability";
import { mountSinkingFund } from "../../src/tiles/sinkingFund";
import { mountRentVsBuy } from "../../src/tiles/rentVsBuy";
import { mountHealthPlan } from "../../src/tiles/healthPlan";
import { mountCashFlow } from "../../src/tiles/cashFlow";
import { mountBudgetOverview } from "../../src/tiles/budgetOverview";
import { mountDebtFreedom } from "../../src/tiles/debtFreedom";
import { mountLifeInsurance } from "../../src/tiles/lifeInsurance";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

/**
 * Expansion tools, first wave (BUILD-SPEC-2 §6): the 50/30/20 Spending Plan
 * (§6.1) and Home Buying Readiness (§6.3). Both are deterministic, deep-linkable,
 * and label their guideline assumptions rather than citing an external rule.
 */
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
    data: null,
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
function clickExample(root: HTMLElement): void {
  Array.from(root.querySelectorAll("button"))
    .find((b) => b.textContent === "Try an example")!
    .click();
}

afterEach(() => document.body.replaceChildren());

describe("50/30/20 Spending Plan", () => {
  it("splits take-home into needs, wants, and savings", () => {
    const { root } = mount(mountSpendingPlan, new URLSearchParams({ th: "5000" }));
    expect(rowValue(root, "Needs (50%)")).toContain("$2,500");
    expect(rowValue(root, "Wants (30%)")).toContain("$1,500");
    expect(rowValue(root, "Savings & debt payoff (20%)")).toContain("$1,000");
    // It's a guideline, not a cited rule.
    expect(root.querySelector("a.cite-link")).toBeNull();
  });

  it("derives savings as the remainder and never goes negative", () => {
    const { root } = mount(
      mountSpendingPlan,
      new URLSearchParams({ th: "4000", n: "70", w: "40" }),
    );
    // Wants is clamped so needs + wants ≤ 100; savings is the remainder (≥ 0).
    expect(rowValue(root, "Savings & debt payoff")).toContain("$0");
  });

  it("writes its state to the URL and prefills an example", () => {
    const { root, lastParams } = mount(mountSpendingPlan, new URLSearchParams());
    clickExample(root);
    expect(root.querySelector<HTMLInputElement>('input[name="th"]')?.value).toBe("5000");
    expect(lastParams()?.get("th")).toBe("5000");
  });

  it("draws a needs/wants/savings donut", () => {
    const { root } = mount(mountSpendingPlan, new URLSearchParams({ th: "5000" }));
    expect(root.querySelector(".chart--donut")).not.toBeNull();
    expect(root.textContent).toContain("Needs (50%)");
  });
});

describe("Home Buying Readiness", () => {
  it("caps the budget by the 28/36 rule and backs out a home price", () => {
    const { root } = mount(
      mountHomeAffordability,
      new URLSearchParams({ inc: "90000", debts: "400", dp: "40000", rate: "6.5", ti: "350" }),
    );
    // Gross monthly = 7,500; 28% = 2,100; 36% − 400 = 2,300; housing binds at 2,100.
    expect(rowValue(root, "Gross monthly income")).toContain("$7,500");
    expect(rowValue(root, "Monthly housing budget")).toContain("$2,100");
    const price = rowValue(root, "Max home price");
    expect(price).toBeTruthy();
  });

  it("lets total-debt bind when other debts are high", () => {
    const { root } = mount(
      mountHomeAffordability,
      new URLSearchParams({ inc: "90000", debts: "1200", dp: "0", rate: "6.5" }),
    );
    // 36% × 7,500 − 1,200 = 1,500 < 28% × 7,500 = 2,100, so the 36% rule binds.
    const budget = rowValue(root, "Monthly housing budget");
    expect(budget).toContain("$1,500");
    expect(
      Array.from(root.querySelectorAll(".bd-label")).some((n) =>
        n.textContent?.includes("36% total debt binds"),
      ),
    ).toBe(true);
  });

  it("reads income from Your Situation and writes it back", () => {
    const profile = new SituationStore();
    profile.set("annualIncome", 120000);
    const { root } = mount(mountHomeAffordability, new URLSearchParams(), profile);
    expect(root.querySelector<HTMLInputElement>('input[name="inc"]')?.value).toBe("120000");
    const inc = root.querySelector<HTMLInputElement>('input[name="inc"]')!;
    inc.value = "100000";
    inc.dispatchEvent(new Event("input"));
    expect(profile.get("annualIncome")).toBe(100000);
  });
});

describe("Sinking Fund Planner", () => {
  it("solves the monthly contribution for a target by a date", () => {
    const { root } = mount(mountSinkingFund, new URLSearchParams({ t: "12000", m: "12", r: "0" }));
    expect(rowValue(root, "Save each month")).toContain("$1,000");
    // The return is the user's assumption, not a cited rule.
    expect(root.querySelector("a.cite-link")).toBeNull();
  });

  it("recognizes when today's savings already reach the goal", () => {
    const { root } = mount(
      mountSinkingFund,
      new URLSearchParams({ t: "8000", c: "10000", m: "12", r: "5" }),
    );
    expect(rowValue(root, "Where you stand")).toContain("on track");
  });

  it("prefills a worked example and deep-links it", () => {
    const { root, lastParams } = mount(mountSinkingFund, new URLSearchParams());
    clickExample(root);
    expect(root.querySelector<HTMLInputElement>('input[name="t"]')?.value).toBe("25000");
    expect(lastParams()?.get("t")).toBe("25000");
  });
});

describe("Rent vs Buy", () => {
  it("compares net cost over the horizon (all rates zero → exact)", () => {
    const { root } = mount(
      mountRentVsBuy,
      new URLSearchParams({
        price: "300000",
        dp: "60000",
        rate: "0",
        own: "500",
        sell: "0",
        appr: "0",
        rent: "2000",
        rg: "0",
        ir: "0",
        y: "5",
      }),
    );
    expect(rowValue(root, "Net cost of buying")).toContain("$30,000");
    expect(rowValue(root, "Net cost of renting")).toContain("$120,000");
    expect(rowValue(root, "Verdict")).toContain("Buying is cheaper by $90,000");
    expect(root.querySelector("a.cite-link")).toBeNull();
  });

  it("prompts for price and rent before comparing", () => {
    const { root } = mount(mountRentVsBuy, new URLSearchParams({ price: "0", rent: "0" }));
    expect(root.querySelector(".ph-empty")).not.toBeNull();
  });
});

describe("Health Plan Chooser", () => {
  it("totals each plan and names the cheaper one", () => {
    const { root } = mount(
      mountHealthPlan,
      new URLSearchParams({
        spend: "8000",
        an: "PPO",
        ap: "450",
        ad: "1500",
        ac: "20",
        ao: "5000",
        bn: "HDHP",
        bp: "250",
        bd: "4000",
        bc: "20",
        bo: "7000",
      }),
    );
    // PPO: 5,400 premiums + 2,800 OOP = 8,200. HDHP: 3,000 + 4,800 = 7,800.
    expect(rowValue(root, "PPO: total for the year")).toContain("$8,200");
    expect(rowValue(root, "HDHP: total for the year")).toContain("$7,800");
    expect(rowValue(root, "Verdict")).toContain("HDHP is cheaper by $400");
    expect(root.querySelector("a.cite-link")).toBeNull();
  });

  it("caps member cost at the out-of-pocket maximum in a high-spend year", () => {
    const { root } = mount(
      mountHealthPlan,
      new URLSearchParams({
        spend: "60000",
        an: "PPO",
        ap: "450",
        ad: "1500",
        ac: "20",
        ao: "5000",
      }),
    );
    // PPO out-of-pocket on care is capped at the 5,000 OOP max.
    expect(rowValue(root, "PPO: out-of-pocket on care")).toContain("$5,000");
  });
});

describe("Cash-Flow Timeline", () => {
  it("finds a day the balance dips negative", () => {
    const { root } = mount(
      mountCashFlow,
      new URLSearchParams({
        s: "800",
        k: "2",
        d0: "1",
        l0: "Rent",
        t0: "bill",
        m0: "1500",
        d1: "3",
        l1: "Paycheck",
        t1: "income",
        m1: "2400",
      }),
    );
    expect(rowValue(root, "Lowest balance")).toContain("700");
    expect(rowValue(root, "Ending balance")).toContain("$1,700");
    expect(rowValue(root, "Heads up")).toContain("day 1");
  });

  it("reports a steady month when the balance stays positive", () => {
    const { root } = mount(
      mountCashFlow,
      new URLSearchParams({ s: "5000", k: "1", d0: "10", l0: "Utilities", t0: "bill", m0: "200" }),
    );
    expect(rowValue(root, "Looks steady")).toBeTruthy();
  });

  it("draws a balance timeline that flags the below-zero day", () => {
    const { root } = mount(
      mountCashFlow,
      new URLSearchParams({
        s: "200",
        k: "2",
        d0: "1",
        l0: "Rent",
        t0: "bill",
        m0: "1500",
        d1: "15",
        l1: "Paycheck",
        t1: "income",
        m1: "2400",
      }),
    );
    expect(root.querySelector(".chart--timeline")).not.toBeNull();
    // Day 1 goes negative (200 − 1500), so a bar carries the warning style.
    expect(root.querySelector(".balance-bar--neg")).not.toBeNull();
  });
});

describe("Budget Overview", () => {
  // income 5000, three categories summing 2700 → 2300 left to assign.
  const params = (): URLSearchParams =>
    new URLSearchParams({
      inc: "5000",
      k: "3",
      c0: "Housing",
      a0: "1600",
      c1: "Groceries",
      a1: "600",
      c2: "Fun",
      a2: "500",
    });

  it("shows the allocation: income, assigned, and left to assign", () => {
    const { root } = mount(mountBudgetOverview, params());
    expect(rowValue(root, "Monthly income")).toContain("$5,000");
    expect(rowValue(root, "Total assigned")).toContain("$2,700");
    expect(rowValue(root, "Left to assign")).toContain("$2,300");
    expect(rowValue(root, "Status")).toContain("still needs a job");
    expect(root.querySelector("a.cite-link")).toBeNull();
  });

  it("celebrates when every dollar has a job", () => {
    const { root } = mount(
      mountBudgetOverview,
      new URLSearchParams({ inc: "2500", k: "2", c0: "Rent", a0: "1600", c1: "Saving", a1: "900" }),
    );
    expect(rowValue(root, "Left to assign")).toContain("$0");
    expect(rowValue(root, "Status")).toContain("Every dollar has a job");
  });

  it("flags over-assignment (red is a genuine warning here)", () => {
    const { root } = mount(
      mountBudgetOverview,
      new URLSearchParams({ inc: "2000", k: "1", c0: "Rent", a0: "2500" }),
    );
    expect(rowValue(root, "Status")).toContain("Over-assigned by $500");
  });

  it("reads income from My Situation when not in the URL", () => {
    const profile = new SituationStore();
    profile.set("annualIncome", 72000);
    const { root } = mount(mountBudgetOverview, new URLSearchParams(), profile);
    // 72000 / 12 = 6000 monthly, nothing assigned yet → all 6000 left.
    expect(rowValue(root, "Monthly income")).toContain("$6,000");
  });

  it("opens with the big default categories when there are none saved", () => {
    const { root } = mount(mountBudgetOverview, new URLSearchParams());
    const names = Array.from(
      root.querySelectorAll<HTMLInputElement>('input[aria-label$="name"]'),
    ).map((i) => i.value);
    expect(names).toContain("Housing");
    expect(names).toContain("Transportation");
    expect(names).toContain("Saving & debt payoff");
  });

  it("draws the allocation donut and flow bar once dollars are assigned", () => {
    const { root } = mount(mountBudgetOverview, params());
    expect(root.querySelector(".chart--donut")).not.toBeNull();
    expect(root.querySelector(".chart--flow")).not.toBeNull();
    // No month timeline here — that lives in the Cash-Flow Timeline tile now.
    expect(root.querySelector(".chart--timeline")).toBeNull();
  });

  it("reorders categories with the keyboard move buttons", () => {
    const { root, lastParams } = mount(
      mountBudgetOverview,
      new URLSearchParams({ inc: "2500", k: "2", c0: "Rent", a0: "1600", c1: "Saving", a1: "900" }),
    );
    const down = Array.from(root.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Move Rent down",
    );
    expect(down).toBeTruthy();
    down!.click();
    expect(lastParams()?.get("c0")).toBe("Saving");
    expect(lastParams()?.get("c1")).toBe("Rent");
  });

  it("spells out the anti-budget idea at the bottom of the page", () => {
    const { root } = mount(mountBudgetOverview, params());
    const why = root.querySelector(".budget-why");
    expect(why).not.toBeNull();
    expect(why?.textContent).toContain("willpower");
  });
});

describe("Debt Freedom Planner", () => {
  const params = (): URLSearchParams =>
    new URLSearchParams({
      k: "2",
      c0: "Visa",
      b0: "1000",
      r0: "20",
      m0: "50",
      c1: "Car",
      b1: "4000",
      r1: "6",
      m1: "150",
      x: "300",
      meth: "snowball",
    });

  it("shows the freedom date, the donut, and both method cards", () => {
    const { root } = mount(mountDebtFreedom, params());
    expect(rowValue(root, "Freedom date (Snowball)")).toBeTruthy();
    expect(rowValue(root, "Total interest")).toBeTruthy();
    expect(root.querySelector(".chart--donut")).not.toBeNull();
    // Both methods compared; snowball is the chosen one by default.
    expect(root.querySelectorAll(".compare-card").length).toBe(2);
    expect(root.querySelector(".compare-card--chosen")).not.toBeNull();
  });

  it("recomputes for the chosen method when a compare card is clicked", () => {
    const { root, lastParams } = mount(mountDebtFreedom, params());
    const avalanche = Array.from(root.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Use the Avalanche method",
    )!;
    avalanche.click();
    expect(lastParams()?.get("meth")).toBe("avalanche");
    expect(rowValue(root, "Freedom date (Avalanche)")).toBeTruthy();
  });

  it("reads debts from My Situation when the URL has none", () => {
    const profile = new SituationStore();
    profile.set("debts", [{ name: "Card", balance: 2000, ratePct: 18 }]);
    const { root } = mount(mountDebtFreedom, new URLSearchParams({ x: "200" }), profile);
    expect(root.textContent).toContain("Card");
    expect(rowValue(root, "Total owed")).toContain("$2,000");
  });

  it("warns plainly when the budget can't outrun the interest", () => {
    const { root } = mount(
      mountDebtFreedom,
      new URLSearchParams({ k: "1", c0: "Trap", b0: "10000", r0: "30", m0: "10", x: "0" }),
    );
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("celebrates when there is no debt to pay", () => {
    const { root } = mount(
      mountDebtFreedom,
      new URLSearchParams({ k: "1", c0: "Paid", b0: "0", r0: "0", m0: "0", x: "0" }),
    );
    expect(root.querySelector(".ph-empty")).not.toBeNull();
  });
});

describe("Life Insurance Needs", () => {
  it("sums the DIME need and subtracts offsets, reading income from My Situation", () => {
    const profile = new SituationStore();
    profile.set("annualIncome", 80000);
    const { root } = mount(
      mountLifeInsurance,
      new URLSearchParams({
        yrs: "10",
        debt: "20000",
        mort: "250000",
        final: "15000",
        edu: "100000",
        cov: "100000",
        assets: "50000",
      }),
      profile,
    );
    expect(rowValue(root, "Total need")).toContain("$1,185,000");
    expect(rowValue(root, "Recommended new coverage")).toContain("$1,035,000");
    expect(root.querySelector("a.cite-link")).toBeNull();
  });
});

describe("expansion tiles accessibility", () => {
  for (const tc of [
    {
      name: "spending-plan",
      mount: mountSpendingPlan,
      params: new URLSearchParams({ th: "5000" }),
    },
    {
      name: "cash-flow",
      mount: mountCashFlow,
      params: new URLSearchParams({
        s: "800",
        k: "1",
        d0: "1",
        l0: "Rent",
        t0: "bill",
        m0: "1500",
      }),
    },
    {
      name: "budget-overview",
      mount: mountBudgetOverview,
      params: new URLSearchParams({
        inc: "5000",
        k: "2",
        c0: "Housing",
        a0: "1600",
        c1: "Groceries",
        a1: "600",
      }),
    },
    {
      name: "debt-freedom",
      mount: mountDebtFreedom,
      params: new URLSearchParams({
        k: "2",
        c0: "Visa",
        b0: "1000",
        r0: "20",
        m0: "50",
        c1: "Car",
        b1: "4000",
        r1: "6",
        m1: "150",
        x: "300",
      }),
    },
    {
      name: "life-insurance",
      mount: mountLifeInsurance,
      params: new URLSearchParams({ inc: "80000", yrs: "10" }),
    },
    {
      name: "home-affordability",
      mount: mountHomeAffordability,
      params: new URLSearchParams({ inc: "90000", dp: "40000", rate: "6.5" }),
    },
    {
      name: "sinking-fund",
      mount: mountSinkingFund,
      params: new URLSearchParams({ t: "25000", c: "5000", m: "36", r: "4" }),
    },
    {
      name: "rent-vs-buy",
      mount: mountRentVsBuy,
      params: new URLSearchParams({ price: "400000", dp: "80000", rate: "6.5", rent: "2200" }),
    },
    {
      name: "health-plan",
      mount: mountHealthPlan,
      params: new URLSearchParams({ spend: "8000" }),
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
