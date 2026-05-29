import { describe, it, expect, afterEach } from "vitest";
import axe from "axe-core";
import { mountPeaceOfMind } from "../../src/tiles/peaceOfMind";
import { mountFreedomDate } from "../../src/tiles/freedomDate";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

/**
 * Safe Harbor (BUILD-SPEC.md §5). The Peace of Mind dashboard consolidates the
 * cushion, runway, net worth, and Enough Number readings from shared inputs;
 * Freedom Date answers the debt-payoff question. Both read Your Situation, are
 * deep-linkable, and follow the §5.3 tone rules.
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

function texts(root: HTMLElement, sel: string): string[] {
  return Array.from(root.querySelectorAll(sel)).map((n) => n.textContent ?? "");
}
function clickExample(root: HTMLElement): void {
  Array.from(root.querySelectorAll("button"))
    .find((b) => b.textContent === "Try an example")!
    .click();
}

function fundedProfile(): SituationStore {
  const p = new SituationStore();
  p.set("essentialMonthlyExpenses", 3200);
  p.set("totalMonthlyExpenses", 4500);
  p.set("liquidSavings", 12000);
  p.set("debts", [{ name: "Card", balance: 4000, ratePct: 22 }]);
  return p;
}

afterEach(() => document.body.replaceChildren());

describe("Peace of Mind dashboard", () => {
  it("shows all four calm readings from shared inputs", () => {
    const { root } = mount(mountPeaceOfMind, new URLSearchParams(), fundedProfile());
    const labels = texts(root, ".ph-reading-label");
    expect(labels).toEqual([
      "Rainy-day cushion",
      "Runway",
      "Net worth (war chest)",
      "My Enough Number",
    ]);
    // Net worth = 12,000 savings + 0 other − 4,000 debts; the sub-line shows the parts.
    const netWorthSub = texts(root, ".ph-reading-sub").find((t) => t.includes("debts"));
    expect(netWorthSub).toContain("$12,000");
    expect(netWorthSub).toContain("$4,000");
  });

  it("prompts for essentials before guessing when the profile is empty", () => {
    const { root } = mount(mountPeaceOfMind, new URLSearchParams());
    expect(root.querySelector(".ph-empty")).not.toBeNull();
    expect(root.querySelectorAll(".ph-reading")).toHaveLength(0);
  });

  it("targets the cushion progress at the chosen month count", () => {
    const { root } = mount(mountPeaceOfMind, new URLSearchParams({ m: "6" }), fundedProfile());
    expect(root.querySelector<HTMLInputElement>('input[name="m"]')?.value).toBe("6");
    const progress = root.querySelector<HTMLProgressElement>(".ph-progress");
    expect(progress?.getAttribute("max")).toBe("6");
  });

  it("writes shared inputs back to Your Situation", () => {
    const profile = new SituationStore();
    const { root } = mount(mountPeaceOfMind, new URLSearchParams(), profile);
    const essential = root.querySelector<HTMLInputElement>('input[name="essential"]')!;
    essential.value = "3000";
    essential.dispatchEvent(new Event("input"));
    expect(profile.get("essentialMonthlyExpenses")).toBe(3000);
  });

  it("prefills a worked example", () => {
    const { root } = mount(mountPeaceOfMind, new URLSearchParams());
    clickExample(root);
    expect(root.querySelector<HTMLInputElement>('input[name="essential"]')?.value).toBe("3200");
    expect(root.querySelectorAll(".ph-reading")).toHaveLength(4);
  });

  it("has no axe violations with readings shown", async () => {
    const { root } = mount(mountPeaceOfMind, new URLSearchParams(), fundedProfile());
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id).join(", ")).toBe("");
  }, 30000);
});

describe("Freedom Date tile", () => {
  it("shows the payoff timeline with interest and a freedom date", () => {
    const { root } = mount(
      mountFreedomDate,
      new URLSearchParams({ b: "6000", r: "22", pay: "300" }),
    );
    const labels = texts(root, ".bd-label");
    expect(labels).toContain("Freedom date");
    expect(labels).toContain("Total interest paid");
    expect(root.querySelector(".result-card")).not.toBeNull();
  });

  it("warns (not silently) when the payment can't cover the interest", () => {
    const { root } = mount(
      mountFreedomDate,
      new URLSearchParams({ b: "10000", r: "18", pay: "150" }),
    );
    expect(root.querySelector(".verify-banner")?.textContent).toContain("never falls");
    expect(root.querySelector(".result-card")).toBeNull();
  });

  it("defaults the balance and a weighted rate from Your Situation debts", () => {
    const profile = new SituationStore();
    profile.set("debts", [
      { name: "Card", balance: 5000, ratePct: 20 },
      { name: "Loan", balance: 5000, ratePct: 10 },
    ]);
    const { root } = mount(mountFreedomDate, new URLSearchParams(), profile);
    expect(root.querySelector<HTMLInputElement>('input[name="b"]')?.value).toBe("10000");
    // Balance-weighted: (5000·20 + 5000·10) / 10000 = 15.
    expect(root.querySelector<HTMLInputElement>('input[name="r"]')?.value).toBe("15");
  });

  it("celebrates calmly when there's no debt", () => {
    const { root } = mount(mountFreedomDate, new URLSearchParams({ b: "0", r: "0", pay: "0" }));
    expect(root.querySelector(".ph-empty")).not.toBeNull();
  });

  it("prefills a worked example and deep-links it", () => {
    const { root, lastParams } = mount(mountFreedomDate, new URLSearchParams());
    clickExample(root);
    expect(root.querySelector<HTMLInputElement>('input[name="b"]')?.value).toBe("6000");
    expect(lastParams()?.get("pay")).toBe("300");
  });
});
