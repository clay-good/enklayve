import { describe, it, expect, afterEach } from "vitest";
import axe from "axe-core";
import { mountSpendingPlan } from "../../src/tiles/spendingPlan";
import { mountHomeAffordability } from "../../src/tiles/homeAffordability";
import { mountSinkingFund } from "../../src/tiles/sinkingFund";
import { mountRentVsBuy } from "../../src/tiles/rentVsBuy";
import { mountHealthPlan } from "../../src/tiles/healthPlan";
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

describe("expansion tiles accessibility", () => {
  for (const tc of [
    {
      name: "spending-plan",
      mount: mountSpendingPlan,
      params: new URLSearchParams({ th: "5000" }),
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
