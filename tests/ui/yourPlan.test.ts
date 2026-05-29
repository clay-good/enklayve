import { describe, it, expect, beforeAll } from "vitest";
import { mountYourPlan } from "../../src/tiles/yourPlan";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";

/**
 * Your Plan tile (BUILD-SPEC-2 §4): the guidance engine made visible. It reads
 * Your Situation, surfaces the next right step with a link to the tile that
 * performs it, is fully adjustable, and keeps its settings in the URL.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(
  params: URLSearchParams,
  profile = new SituationStore(),
): {
  root: HTMLElement;
  lastParams: () => URLSearchParams | null;
  navigatedTo: () => string | null;
} {
  const root = document.createElement("div");
  let captured: URLSearchParams | null = null;
  let dest: string | null = null;
  mountYourPlan({
    root,
    params,
    setParams: (p) => {
      captured = p;
    },
    permalink: (p) => `https://enklayve.com/#/your-plan?${(p ?? params).toString()}`,
    navigate: (id) => {
      dest = id;
    },
    locale: "en-US",
    data,
    profile,
  } satisfies TileContext);
  return { root, lastParams: () => captured, navigatedTo: () => dest };
}

function workedProfile(): SituationStore {
  const p = new SituationStore();
  p.set("liquidSavings", 2500);
  p.set("essentialMonthlyExpenses", 3200);
  p.set("employerMatchAnnual", 3000);
  p.set("employerMatchCaptured", 3000);
  p.set("retirementContributionsAnnual", 8000);
  p.set("debts", [{ name: "Credit card", balance: 6000, ratePct: 23 }]);
  return p;
}

describe("Your Plan tile", () => {
  it("surfaces the next right step from the profile", () => {
    const { root } = mount(new URLSearchParams(), workedProfile());
    expect(root.querySelector(".plan-next-title")?.textContent).toBe("Clear high-cost debt");
    expect(root.querySelector(".plan-next-action")?.textContent).toContain("Credit card");
    // The next step shows a dollar figure.
    expect(root.querySelector(".plan-next-amount")?.textContent).toContain("$");
  });

  it("links the next step to the tile that performs it", () => {
    const { root, navigatedTo } = mount(new URLSearchParams(), workedProfile());
    const open = Array.from(root.querySelectorAll("button")).find((b) =>
      b.textContent?.startsWith("Open the tool that does this"),
    );
    open?.click();
    expect(navigatedTo()).toBe("freedom-date");
  });

  it("cites the IRS retirement limit somewhere in the plan", () => {
    const { root } = mount(new URLSearchParams(), workedProfile());
    expect(root.querySelector("a.cite-link")?.getAttribute("href")).toMatch(/irs\.gov/);
  });

  it("falls back to the starter cushion for an empty profile", () => {
    const { root } = mount(new URLSearchParams());
    expect(root.querySelector(".plan-next-title")?.textContent).toBe("Starter cushion");
  });

  it("restores adjustable settings from a deep link", () => {
    const { root } = mount(new URLSearchParams({ ds: "balance", m: "6" }), workedProfile());
    expect(root.querySelector<HTMLSelectElement>('select[name="ds"]')?.value).toBe(
      "smallest-balance",
    );
    expect(root.querySelector<HTMLInputElement>('input[name="m"]')?.value).toBe("6");
  });

  it("writes a turned-off step to the URL", () => {
    const { root, lastParams } = mount(new URLSearchParams(), workedProfile());
    const checkbox = root.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
    checkbox!.checked = false;
    checkbox!.dispatchEvent(new Event("change"));
    expect(lastParams()?.get("off")).toContain("starter-cushion");
  });

  it("prefills a worked example and recomputes", () => {
    const { root } = mount(new URLSearchParams());
    const example = Array.from(root.querySelectorAll("button")).find(
      (b) => b.textContent === "Try an example",
    );
    example?.click();
    expect(root.querySelector<HTMLInputElement>('input[name="savings"]')?.value).toBe("2500");
    expect(root.querySelector(".plan-next-title")?.textContent).toBe("Clear high-cost debt");
  });
});
