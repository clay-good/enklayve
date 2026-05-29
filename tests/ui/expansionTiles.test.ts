import { describe, it, expect, afterEach } from "vitest";
import axe from "axe-core";
import { mountSpendingPlan } from "../../src/tiles/spendingPlan";
import { mountHomeAffordability } from "../../src/tiles/homeAffordability";
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
  ]) {
    it(`${tc.name} has no axe violations`, async () => {
      const { root } = mount(tc.mount, tc.params);
      document.body.append(root);
      const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
      expect(results.violations.map((v) => v.id).join(", ")).toBe("");
    }, 30000);
  }
});
