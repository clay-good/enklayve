import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { mountEobChecker, eobCheckerTile } from "../../src/tiles/eobChecker";
import { claimPatientResponsibility } from "../../src/engine/finance";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import type { TileContext } from "../../src/tiles/types";

/**
 * Medical Bill & EOB Checker (SPEC-4-safety-net §B1), harm tier 3.
 *
 * The tier-3 rule is screener-only: it may state what the No Surprises Act
 * covers and recompute the plan's arithmetic, and it may never conclude that a
 * household does not owe a bill. These tests exist to make that impossible to
 * erode later — "you're protected, don't pay this" is exactly the phrasing a
 * well-meaning future edit would reach for, and it is the one sentence here
 * that could cost someone their credit.
 */
let data: BundledData;
beforeAll(async () => {
  data = await loadBundledData();
});

function mount(params: URLSearchParams, bundled: BundledData | null = data): HTMLElement {
  const root = document.createElement("div");
  mountEobChecker({
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

/** $2,000 allowed against a $1,500 deductible with 20% coinsurance:
 * $1,500 + 20% of $500 = $1,600. The notice claiming $950 is the gap. */
const MISMATCH = new URLSearchParams({
  alw: "2000",
  ded: "1500",
  dmet: "0",
  coin: "20",
  oop: "6000",
  omet: "0",
  bill: "950",
  net: "out",
  set: "er",
});

const RECONCILES = new URLSearchParams({ ...Object.fromEntries(MISMATCH), bill: "1600" });
const GROUND_AMBULANCE = new URLSearchParams({ ...Object.fromEntries(MISMATCH), set: "ground" });
const IN_NETWORK = new URLSearchParams({ ...Object.fromEntries(MISMATCH), net: "in" });

describe("claimPatientResponsibility", () => {
  it("fills the remaining deductible, then applies coinsurance", () => {
    const r = claimPatientResponsibility({
      allowedAmount: 2000,
      deductible: 1500,
      deductibleMet: 0,
      coinsuranceRate: 0.2,
      outOfPocketMax: 6000,
      outOfPocketMet: 0,
    });
    expect(r.toDeductible.toNumber()).toBe(1500);
    expect(r.coinsurance.toNumber()).toBe(100);
    expect(r.patientResponsibility.toNumber()).toBe(1600);
    expect(r.cappedByOutOfPocketMax).toBe(false);
  });

  it("counts only the deductible the member has left", () => {
    const r = claimPatientResponsibility({
      allowedAmount: 2000,
      deductible: 1500,
      deductibleMet: 1200,
      coinsuranceRate: 0.2,
      outOfPocketMax: 6000,
      outOfPocketMet: 1200,
    });
    // $300 of deductible left, then 20% of the remaining $1,700 = $340.
    expect(r.patientResponsibility.toNumber()).toBe(640);
  });

  it("caps the member's share at what is left of the out-of-pocket maximum", () => {
    const r = claimPatientResponsibility({
      allowedAmount: 50000,
      deductible: 1500,
      deductibleMet: 0,
      coinsuranceRate: 0.2,
      outOfPocketMax: 6000,
      outOfPocketMet: 5500,
    });
    expect(r.patientResponsibility.toNumber()).toBe(500);
    expect(r.cappedByOutOfPocketMax).toBe(true);
  });

  it("returns a finite, non-negative share for absurd and absent inputs", () => {
    for (const bad of [NaN, Infinity, -1e9, Number.MAX_VALUE]) {
      const r = claimPatientResponsibility({
        allowedAmount: bad,
        deductible: bad,
        deductibleMet: bad,
        coinsuranceRate: bad,
        outOfPocketMax: bad,
        outOfPocketMet: bad,
      });
      expect(Number.isFinite(r.patientResponsibility.toNumber())).toBe(true);
      expect(r.patientResponsibility.toNumber()).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("Medical Bill & EOB Checker", () => {
  it("recomputes the plan's own math and names the gap", () => {
    const root = mount(MISMATCH);
    const text = root.textContent ?? "";
    expect(text).toContain("$1,600.00");
    // $1,600 expected against $950 on the notice.
    expect(text).toContain("$650");
    expect(text).toContain("worth asking your plan about");
    // The gap never stands alone: the innocent explanations sit beside it.
    expect(text).toContain("A gap does not mean the plan is wrong");
  });

  it("says so plainly when the notice reconciles, with no caveat block", () => {
    const text = mount(RECONCILES).textContent ?? "";
    expect(text).toContain("reconciles with your plan's terms");
    expect(text).not.toContain("A gap does not mean the plan is wrong");
  });

  it("states the No Surprises scope from the shard, with its citation", () => {
    const root = mount(MISMATCH);
    const text = root.textContent ?? "";
    expect(text).toContain("emergency room visit");
    expect(text).toContain("2022-01-01");
    const cite = Array.from(root.querySelectorAll("a.cite-link")).map((a) =>
      a.getAttribute("href"),
    );
    expect(cite.some((h) => h?.includes("cms.gov"))).toBe(true);
  });

  it("names what the Act does not reach, so the scope is never overstated", () => {
    const text = mount(MISMATCH).textContent ?? "";
    expect(text).toContain("Ground ambulance");
    expect(text).toContain("Vision-only and dental-only plans");
    // The waiver is stated in the same breath as the protection.
    expect(text).toContain("notice and consent form");
  });

  it("says a ground ambulance is outside the protections rather than staying quiet", () => {
    const text = mount(GROUND_AMBULANCE).textContent ?? "";
    expect(text).toContain("is not covered by the No Surprises Act's billing protections");
  });

  it("does not raise the surprise-billing rule for an in-network claim", () => {
    const text = mount(IN_NETWORK).textContent ?? "";
    expect(text).toContain("not the rule in play here");
  });

  it("never tells the household it does not owe the bill", () => {
    for (const params of [MISMATCH, RECONCILES, GROUND_AMBULANCE, IN_NETWORK]) {
      const text = (mount(params).textContent ?? "").toLowerCase();
      for (const forbidden of [
        "you do not owe",
        "you don't owe",
        "don't pay",
        "do not pay this",
        "you were overcharged",
        "this bill is wrong",
        "illegal",
      ]) {
        expect(text).not.toContain(forbidden);
      }
      expect(text).toContain("this is a screener, not a determination");
    }
  });

  it("degrades to the help-desk number when the scope data is unavailable", () => {
    const root = mount(MISMATCH, null);
    expect(root.querySelector(".verify-banner")?.textContent).toContain("1-800-985-3059");
    // The arithmetic still runs — it needs no dataset.
    expect(root.textContent).toContain("$1,600.00");
  });

  it("clears the tier-3 bar: named free channels and the advice line", () => {
    expect(checkHarmTier([eobCheckerTile as AuditTile])).toEqual([]);
    expect(eobCheckerTile.harmTier).toBe(3);
    expect(eobCheckerTile.channels?.length).toBeGreaterThan(0);
    expect(eobCheckerTile.how).toMatch(/not legal, medical, or financial advice/i);
  });

  it("has no axe violations", async () => {
    const root = mount(MISMATCH);
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id).join(", ")).toBe("");
    document.body.replaceChildren();
  }, 30000);
});
