import { describe, it, expect, beforeAll } from "vitest";
import axe from "axe-core";
import { compareFilingStatus } from "../../src/engine/filingComparison";
import { estimateEitc } from "../../src/engine/benefits";
import { filingJointlyVsSeparatelyTile } from "../../src/tiles/filingJointlyVsSeparately";
import { mountFilingJointlyVsSeparately } from "../../src/tiles/filingJointlyVsSeparatelyView";
import { loadBundledData, type BundledData } from "../../src/data/browser";
import { SituationStore } from "../../src/profile/situation";
import { checkHarmTier, type AuditTile } from "../../scripts/audit-release";
import type { TaxContext } from "../../src/engine/tax";
import type { TileContext } from "../../src/tiles/types";

/**
 * Married: Jointly or Separately? (SPEC-5 Phase 28).
 *
 * Worked by hand from the shards: a joint return's $32,200 standard deduction
 * and 10% to $24,800; a separate return's $16,100, 10% to $12,400 and 12% to
 * $50,400; the Child Tax Credit at $2,200 a child with $1,700 refundable.
 * One spouse earning $48,000 with two children, in Texas (no income tax):
 *  - joint: $15,800 taxable, $1,580 of tax;
 *  - separate: $31,900 taxable, $1,240 + $2,340 = $3,580 of tax, the spouse $0;
 *  - the Child Tax Credit is $4,400 either way ($3,400 refundable, $1,000 used
 *    against tax), so the difference is $2,000 of tax plus the joint EITC.
 */
let data: BundledData;
let ctx: TaxContext;
beforeAll(async () => {
  data = await loadBundledData();
  ctx = { federal: data.federal()!, fica: data.fica()! };
});

describe("one couple, two ways", () => {
  it("costs a one-earner couple $2,000 plus the EITC to file separately", () => {
    const r = compareFilingStatus(
      { wagesA: 48000, wagesB: 0, qualifyingChildren: 2, childrenClaimedBy: "a" },
      ctx,
      data.eitcCtc()!,
    );
    expect(r.joint.federalIncomeTax.toNumber()).toBe(1580);
    expect(r.separateA.federalIncomeTax.toNumber()).toBe(3580);
    expect(r.separateB.federalIncomeTax.toNumber()).toBe(0);
    expect(r.joint.childTaxCredit.toNumber()).toBe(4400);
    expect(r.separateA.childTaxCredit.toNumber()).toBe(4400);
    const eitc = estimateEitc(
      { earnedIncome: 48000, qualifyingChildren: 2, married: true },
      data.eitcCtc()!,
    ).credit.toNumber();
    expect(eitc).toBeGreaterThan(0);
    expect(r.joint.eitc.toNumber()).toBe(eitc);
    expect(r.separateA.eitc.toNumber()).toBe(0);
    expect(r.separateCostsMore.toNumber()).toBeCloseTo(2000 + eitc, 6);
  });

  it("gives the children's credit to the spouse who claims them on separate returns", () => {
    const r = compareFilingStatus(
      { wagesA: 48000, wagesB: 30000, qualifyingChildren: 1, childrenClaimedBy: "b" },
      ctx,
      data.eitcCtc()!,
    );
    expect(r.separateA.childTaxCredit.toNumber()).toBe(0);
    expect(r.separateB.childTaxCredit.toNumber()).toBe(2200);
  });

  it("phases the credit out from $200,000 on a separate return and $400,000 jointly", () => {
    const r = compareFilingStatus(
      { wagesA: 210000, wagesB: 190000, qualifyingChildren: 1, childrenClaimedBy: "a" },
      ctx,
      data.eitcCtc()!,
    );
    // $10,000 over $200,000 is ten $50 steps: $2,200 - $500.
    expect(r.separateA.childTaxCredit.toNumber()).toBe(1700);
    expect(r.joint.childTaxCredit.toNumber()).toBe(2200);
  });
});

function mount(params: URLSearchParams, bundled: BundledData | null = data): HTMLElement {
  const root = document.createElement("div");
  mountFilingJointlyVsSeparately({
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

const CASE = new URLSearchParams({ a: "48000", b: "0", kids: "2", by: "a", st: "TX" });

describe("Married: Jointly or Separately?", () => {
  it("says which saves, and names the EITC given up, cited", () => {
    const root = mount(CASE);
    const text = root.textContent ?? "";
    expect(text).toContain("Filing jointly saves this year");
    expect(text).toContain("Earned Income Credit given up on separate returns");
    const sources = [...root.querySelectorAll("a.cite-link")].map((a) => a.getAttribute("href"));
    expect(sources).toContain(data.eitcCtc()!.citation.sourceUrl);
    expect(sources).toContain(data.federal()!.citation.sourceUrl);
  });

  it("degrades to a banner, never a figure, when the rules are missing", () => {
    const root = mount(CASE, null);
    expect(root.querySelector(".verify-banner")).not.toBeNull();
    expect(root.textContent).not.toMatch(/\$\d/);
  });

  it("declares harm tier 1 and clears the gate", () => {
    expect(filingJointlyVsSeparatelyTile.harmTier).toBe(1);
    expect(checkHarmTier([filingJointlyVsSeparatelyTile as AuditTile])).toEqual([]);
  });

  it("has no axe violations", async () => {
    const root = mount(CASE);
    document.body.append(root);
    const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
    root.remove();
    expect(results.violations).toEqual([]);
  });
});
