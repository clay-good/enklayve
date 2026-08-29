import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { mountGarnishment, garnishmentTile } from "../../src/tiles/garnishment";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import type { TileContext } from "../../src/tiles/types";

/**
 * Wage Garnishment Limits (SPEC-4-safety-net §B2), harm tier 3.
 *
 * The acceptance criterion SPEC-4 §Phase 23 names explicitly: the tile renders
 * the federal-ceiling caveat **above** the figure, asserted by a DOM-order test
 * rather than by review. An edit that moved it below would look harmless in a
 * diff and would invert what the page says — the number would read as the
 * answer, and the state that protects more would read as a footnote.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(params: URLSearchParams, bundled: BundledData | null = data): HTMLElement {
  const root = document.createElement("div");
  mountGarnishment({
    root,
    params,
    setParams: () => {},
    permalink: (p) => `https://enklayve.com/#/x?${(p ?? params).toString()}`,
    navigate: () => {},
    locale: "en-US",
    data: bundled,
    profile: new SituationStore(),
  } as TileContext);
  return root;
}

const ORDINARY = new URLSearchParams({ dis: "600", per: "weekly", kind: "ordinary" });
const LOW = new URLSearchParams({ dis: "250", per: "weekly", kind: "ordinary" });
const SUPPORT = new URLSearchParams({
  dis: "1000",
  per: "weekly",
  kind: "support",
  sup: "1",
  arr: "0",
});
const TAX = new URLSearchParams({ dis: "1000", per: "weekly", kind: "tax" });

/** Where a node sits in the rendered result, in document order. */
function positionOf(root: HTMLElement, selector: string): number {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(".tile-result > *"));
  return nodes.findIndex((n) => n.matches(selector));
}

describe("Wage Garnishment Limits", () => {
  it("renders the state-variance caveat ABOVE the figure", () => {
    for (const params of [ORDINARY, LOW, SUPPORT, TAX]) {
      const root = mount(params);
      const caveat = positionOf(root, ".grn-caveat");
      const figure = positionOf(root, ".grn-figure");
      expect(caveat).toBeGreaterThanOrEqual(0);
      expect(figure).toBeGreaterThanOrEqual(0);
      expect(caveat).toBeLessThan(figure);
    }
  });

  it("says a more protective state law governs, and cites the statute", () => {
    const root = mount(ORDINARY);
    const caveat = root.querySelector(".grn-caveat");
    expect(caveat?.textContent).toContain("Read this before the number");
    expect(caveat?.textContent).toContain("the state rule is the one that applies");
    expect(caveat?.querySelector("a.cite-link")?.getAttribute("href")).toContain("1673");
  });

  it("states the federal ceiling and which of the two tests produced it", () => {
    // $600 weekly: 25% is $150, and $382.50 sits above the $217.50 floor.
    const text = mount(ORDINARY).textContent ?? "";
    expect(text).toContain("$150.00");
    expect(text).toContain("25% of disposable earnings is the lower of the two federal tests");
  });

  it("names the protected floor when it is the floor that binds", () => {
    // $250 weekly: only $32.50 sits above the $217.50 floor.
    const text = mount(LOW).textContent ?? "";
    expect(text).toContain("$32.50");
    expect(text).toContain("$217.50");
    expect(text).toContain("30 times the $7.25 federal minimum hourly wage");
  });

  it("applies the support-order share and says it is exempt from the ordinary ceiling", () => {
    const text = mount(SUPPORT).textContent ?? "";
    expect(text).toContain("$500.00");
    expect(text).toContain("exempt from the ordinary 25% ceiling");
  });

  it("reports the absence of a ceiling rather than implying none exists", () => {
    const text = mount(TAX).textContent ?? "";
    expect(text).toContain("Federal law sets no ceiling here");
    // "not an unlimited one" is the whole point of saying it this way.
    expect(text).toContain("not an unlimited one");
    expect(text).toContain("IRC §6334");
  });

  it("always names the debts the ceiling does not reach, whatever is selected", () => {
    for (const params of [ORDINARY, SUPPORT, TAX]) {
      const text = mount(params).textContent ?? "";
      expect(text).toContain("A debt due for any state or federal tax");
      expect(text).toContain("chapter 13 bankruptcy case");
    }
  });

  it("states the §1674 protection against being fired over one debt", () => {
    const text = mount(ORDINARY).textContent ?? "";
    expect(text).toContain("cannot be fired over one debt");
    expect(text).toContain("may not discharge you");
  });

  it("never tells the household what a creditor may actually take", () => {
    for (const params of [ORDINARY, LOW, SUPPORT, TAX]) {
      const text = (mount(params).textContent ?? "").toLowerCase();
      for (const forbidden of [
        "they can take",
        "you must pay",
        "this is what will be taken",
        "you have no protection",
        "nothing you can do",
      ]) {
        expect(text).not.toContain(forbidden);
      }
      expect(text).toContain("this is a screener, not a determination and not a defense");
    }
  });

  it("degrades to the state caveat when the limit data is unavailable", () => {
    const root = mount(ORDINARY, null);
    const banner = root.querySelector(".verify-banner")?.textContent ?? "";
    expect(banner).toContain("no ceiling is stated here");
    expect(banner).toContain("Your state may protect more");
    expect(root.querySelector(".grn-figure")).toBeNull();
  });

  it("clears the tier-3 bar: named free channels and the advice line", () => {
    expect(checkHarmTier([garnishmentTile as AuditTile])).toEqual([]);
    expect(garnishmentTile.harmTier).toBe(3);
    expect(garnishmentTile.channels?.length).toBeGreaterThan(0);
    expect(garnishmentTile.how).toMatch(/not legal or financial advice/i);
  });

  it("has no axe violations", async () => {
    const root = mount(SUPPORT);
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id).join(", ")).toBe("");
    document.body.replaceChildren();
  }, 30000);
});
