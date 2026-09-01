import { describe, it, expect, beforeAll } from "vitest";
import { mountAutoLoan } from "../../src/tiles/autoLoan";
import { mountFederalIncomeTax } from "../../src/tiles/federalIncomeTax";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import type { TileContext } from "../../src/tiles/types";
import { getTile, hubIdForTool } from "../../src/tiles/registry";

/**
 * Auto Loan hands its interest figure to the deduction that spends it.
 *
 * IRC §163(h)(4) deducts car loan interest paid **in the taxable year**, and
 * the Auto Loan tile is the only place on the site that knows what that is —
 * it has the balance, the rate, and the schedule. Telling a reader to copy a
 * number between two calculators is how a number gets copied wrong, and the
 * number most likely to be copied here is the wrong one: the total cost of
 * credit over six years rather than one year of interest.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(
  mountFn: (ctx: TileContext) => void,
  params: URLSearchParams,
  navigate: TileContext["navigate"] = () => {},
): HTMLElement {
  const root = document.createElement("div");
  mountFn({
    root,
    params,
    setParams: () => {},
    permalink: () => "https://enklayve.com/#/x",
    navigate,
    locale: "en-US",
    data,
    profile: new SituationStore(),
  });
  return root;
}

describe("the Auto Loan → Federal Income Tax handoff", () => {
  it("carries the first year's interest, not the life-of-loan total", () => {
    const calls: { tile: string | null; params?: URLSearchParams }[] = [];
    const root = mount(
      mountAutoLoan,
      new URLSearchParams({ a: "32000", apr: "7.5", y: "6", f: "1500" }),
      (tile, params) => calls.push({ tile, params }),
    );
    const button = [...root.querySelectorAll("button")].find(
      (b) => b.textContent === "Deduct this interest",
    );
    expect(button).toBeDefined();
    button!.dispatchEvent(new Event("click"));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.tile).toBe("federal-income-tax");
    const carint = Number(calls[0]?.params?.get("carint"));
    // A $33,500 loan at 7.5% over six years costs about $8,100 in interest all
    // told and about $2,300 in its first year. Handing over the first figure
    // would claim a deduction more than three times too large.
    expect(carint).toBeGreaterThan(2200);
    expect(carint).toBeLessThan(2400);
  });

  it("lands on a Federal Income Tax tile that reads the parameter", () => {
    // The other half of the handoff: a link is only a handoff if the far end
    // picks it up.
    const fed = mount(mountFederalIncomeTax, new URLSearchParams({ carint: "2300" }));
    expect(fed.querySelector<HTMLInputElement>('input[name="carint"]')?.value).toBe("2300");
  });

  it("shows the first year's interest beside the total, so the two are not confused", () => {
    const root = mount(mountAutoLoan, new URLSearchParams({ a: "32000", apr: "7.5", y: "6" }));
    const text = root.textContent ?? "";
    expect(text).toContain("True cost of credit");
    expect(text).toContain("Interest in the first 12 months");
  });
});

describe("navigating between calculators in different hubs", () => {
  it("resolves a sub-tool to the hub that owns it, and keeps the params", () => {
    // A calculator is not a route: `federal-income-tax` lives at
    // `#/paycheck-taxes?tool=federal-income-tax`. The hub used to remap only
    // its OWN tools, so a cross-hub target fell through as a tile id the router
    // cannot resolve and dropped the reader on the home page — and the remap it
    // did perform threw the caller's params away, so a link carrying a value
    // arrived empty even when it arrived. Both are why this is tested at the
    // hub rather than only at the button.
    expect(hubIdForTool("federal-income-tax")).toBe("paycheck-taxes");
    expect(hubIdForTool("auto-loan")).toBe("debt");
    // A hub is a route in its own right and is not a sub-tool of anything.
    expect(hubIdForTool("paycheck-taxes")).toBeUndefined();
  });

  it("carries the interest through the hub to the field, not just to the router", () => {
    const calls: { tile: string | null; params?: URLSearchParams }[] = [];
    const root = document.createElement("div");
    // Mounted as the reader reaches it: the debt hub, switched to Auto Loan.
    const debtHub = getTile("debt");
    expect(debtHub?.mount).toBeDefined();
    debtHub!.mount!({
      root,
      params: new URLSearchParams({ tool: "auto-loan", a: "32000", apr: "7.5", y: "6" }),
      setParams: () => {},
      permalink: () => "https://enklayve.com/#/x",
      navigate: (tile, params) => calls.push({ tile, params }),
      locale: "en-US",
      data,
      profile: new SituationStore(),
    });
    const button = [...root.querySelectorAll("button")].find(
      (b) => b.textContent === "Deduct this interest",
    );
    button!.dispatchEvent(new Event("click"));

    expect(calls[0]?.tile).toBe("paycheck-taxes");
    expect(calls[0]?.params?.get("tool")).toBe("federal-income-tax");
    expect(Number(calls[0]?.params?.get("carint"))).toBeGreaterThan(2000);
  });
});
